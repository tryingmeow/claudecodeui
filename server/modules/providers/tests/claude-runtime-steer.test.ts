import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { ClaudeSessionsProvider } from '@/modules/providers/list/claude/claude-sessions.provider.js';
import { CLAUDE_PREDEFINED_MODELS } from '@/modules/providers/list/claude/claude-models.provider.js';
import {
  abortClaudeSDKSession,
  queryClaudeSDK,
  steerClaudeSDKSession,
} from '@/modules/providers/list/claude/claude-runtime.provider.js';
import type { NormalizedMessage, ProviderRuntimeContext } from '@/shared/types.js';

/**
 * Steering writes a user message into a run's live CLI stdin. These drive
 * `queryClaudeSDK` with a scripted SDK stream (the `context.createQuery` seam)
 * that records everything the run writes to stdin, and check when the client
 * is told the work is over.
 */

const SESSION_ID = 'app-steer-session';
const NATIVE_ID = 'native-steer-session';

type SdkUserMessage = { type: string; uuid?: string; message: { content: unknown } };

type Scripted = {
  emit: (message: Record<string, unknown>) => void;
  end: () => void;
  released: () => boolean;
  closed: () => boolean;
  stdin: SdkUserMessage[];
};

function createScriptedQuery(): { createQuery: NonNullable<ProviderRuntimeContext['createQuery']>; script: Scripted } {
  const queue: Array<Record<string, unknown> | null> = [];
  let wake: (() => void) | null = null;
  let released = false;
  let closed = false;
  const stdin: SdkUserMessage[] = [];

  const script: Scripted = {
    emit: (message) => { queue.push(message); wake?.(); },
    end: () => { queue.push(null); wake?.(); },
    released: () => released,
    closed: () => closed,
    stdin,
  };

  const createQuery: NonNullable<ProviderRuntimeContext['createQuery']> = ({ prompt }) => {
    void (async () => {
      for await (const message of prompt) {
        stdin.push(message as SdkUserMessage);
      }
      released = true;
    })();

    const iterator = (async function* () {
      for (;;) {
        if (queue.length === 0) {
          await new Promise<void>((resolve) => { wake = resolve; });
          wake = null;
          continue;
        }
        const next = queue.shift();
        if (next === null || next === undefined) {
          return;
        }
        yield next;
      }
    })();

    return Object.assign(iterator, {
      interrupt: async () => {},
      stopTask: async () => {},
      close: () => { closed = true; script.end(); },
    });
  };

  return { createQuery, script };
}

async function withRun(
  runTest: (context: { script: Scripted; sent: NormalizedMessage[] }) => Promise<void>,
): Promise<void> {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'claude-runtime-steer-'));
  const { createQuery, script } = createScriptedQuery();
  const sent: NormalizedMessage[] = [];
  const writer = { send: (message: NormalizedMessage) => { sent.push(message); }, userId: null };
  const sessions = new ClaudeSessionsProvider({ getLiveRunStartTime: () => null });
  const context: ProviderRuntimeContext = {
    resolveProviderSessionId: () => null,
    resolveResumeModel: async () => undefined,
    getProviderModels: async () => CLAUDE_PREDEFINED_MODELS as never,
    normalizeMessage: (raw, sessionId) => sessions.normalizeMessage(raw, sessionId),
    isProviderInstalled: async () => true,
    createQuery,
  };

  try {
    const done = queryClaudeSDK('hello', { sessionId: SESSION_ID, cwd }, writer as never, context);
    await runTest({ script, sent });
    script.end();
    await done;
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
}

const settle = () => new Promise((resolve) => { setTimeout(resolve, 25); });

const init = () => ({ type: 'system', subtype: 'init', session_id: NATIVE_ID });
const replay = (uuid: string, content: string) => ({
  type: 'user', isReplay: true, uuid, session_id: NATIVE_ID, parent_tool_use_id: null,
  message: { role: 'user', content },
});
const toolUse = (id: string, name: string, input: Record<string, unknown>) => ({
  type: 'assistant', session_id: NATIVE_ID, parent_tool_use_id: null,
  message: { role: 'assistant', content: [{ type: 'tool_use', id, name, input }] },
});
const ack = (id: string, text: string, toolUseResult: Record<string, unknown>) => ({
  type: 'user', session_id: NATIVE_ID, parent_tool_use_id: null,
  message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: text }] },
  tool_use_result: toolUseResult,
});
const taskStarted = (taskId: string, toolUseId: string) => ({
  type: 'system', subtype: 'task_started', session_id: NATIVE_ID, task_id: taskId, tool_use_id: toolUseId, description: `Task ${taskId}`, task_type: 'local_agent',
});
const result = () => ({ type: 'result', subtype: 'success', session_id: NATIVE_ID, result: 'ok', duration_ms: 1, num_turns: 1 });
const completes = (sent: NormalizedMessage[]) => sent.filter((message) => message.kind === 'complete').length;

test('a mid-turn steer reaches stdin and the turn completes once', async () => {
  await withRun(async ({ script, sent }) => {
    script.emit(init());
    await settle();

    const outcome = await steerClaudeSDKSession(SESSION_ID, 'change of plan', {}, { allowNewTurn: false });
    assert.deepEqual(outcome, { delivered: true, newTurn: false });
    await settle();
    const steered = script.stdin.at(-1);
    assert.equal(steered?.message.content, 'change of plan');
    assert.ok(steered?.uuid, 'the steered message carries a uuid the CLI echoes back');

    // Read at the next tool boundary: the CLI echoes it, then ends the turn.
    script.emit(replay(steered.uuid, 'change of plan'));
    script.emit(result());
    await settle();

    assert.equal(completes(sent), 1);
    assert.ok(
      !sent.some((message) => message.kind === 'text' && message.role === 'user'),
      'the echo is not forwarded: the client already shows what it sent',
    );
  });
});

test('a steer the turn could not take keeps the run open until the CLI answers it', async () => {
  await withRun(async ({ script, sent }) => {
    script.emit(init());
    await settle();
    await steerClaudeSDKSession(SESSION_ID, 'one more thing', {}, { allowNewTurn: false });
    await settle();
    const steered = script.stdin.at(-1);
    assert.ok(steered?.uuid);

    // No tool boundary left: the turn ends before the CLI takes it in.
    script.emit(result());
    await settle();
    assert.equal(completes(sent), 0, 'the work is not over while the steer is outstanding');
    assert.equal(script.released(), false, 'stdin stays open for the turn that answers it');

    script.emit(replay(steered.uuid, 'one more thing'));
    script.emit(result());
    await settle();
    assert.equal(completes(sent), 1);
  });
});

test('after the turn completed, a steer is refused unless a new turn is allowed', async () => {
  await withRun(async ({ script, sent }) => {
    script.emit(init());
    script.emit(toolUse('toolu_agent', 'Agent', { prompt: 'sleep 90', subagent_type: 'general-purpose', run_in_background: true }));
    script.emit(taskStarted('a1', 'toolu_agent'));
    script.emit(ack('toolu_agent', 'Async agent launched successfully.', { status: 'async_launched', agentId: 'a1' }));
    script.emit(result());
    await settle();
    assert.equal(completes(sent), 1);
    assert.equal(script.released(), false, 'held open for the background agent');

    assert.deepEqual(
      await steerClaudeSDKSession(SESSION_ID, 'not mid-turn', {}, { allowNewTurn: false }),
      { delivered: false, newTurn: false },
    );

    const outcome = await steerClaudeSDKSession(SESSION_ID, 'next question', {}, { allowNewTurn: true });
    assert.deepEqual(outcome, { delivered: true, newTurn: true });
    await settle();
    const steered = script.stdin.at(-1);
    assert.equal(steered?.message.content, 'next question');
    assert.equal(script.released(), false, 'the agent keeps its process');

    script.emit(replay(steered!.uuid!, 'next question'));
    script.emit(result());
    await settle();
    assert.equal(completes(sent), 2, 'the new turn ends with its own complete');
    assert.equal(script.released(), false, 'still held: the agent has not reported');
  });
});

test('a steer is refused once the process was let go', async () => {
  await withRun(async ({ script }) => {
    script.emit(init());
    script.emit(result());
    await settle();
    assert.equal(script.released(), true);
    assert.deepEqual(
      await steerClaudeSDKSession(SESSION_ID, 'too late', {}, { allowNewTurn: true }),
      { delivered: false, newTurn: false },
    );
  });
});

test('aborting with a steer the CLI has not reached ends the process', async () => {
  await withRun(async ({ script }) => {
    script.emit(init());
    await settle();
    await steerClaudeSDKSession(SESSION_ID, 'queued in the CLI', {}, { allowNewTurn: false });
    await settle();

    assert.equal(await abortClaudeSDKSession(SESSION_ID), true);
    assert.equal(script.closed(), true, 'an interrupt alone would leave the CLI to answer it after the abort');
  });
});
