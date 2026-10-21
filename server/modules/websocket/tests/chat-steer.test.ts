import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { closeConnection, initializeDatabase, sessionsDb } from '@/modules/database/index.js';
import { handleChatConnection } from '@/modules/websocket/services/chat-websocket.service.js';
import { chatRunRegistry } from '@/modules/websocket/services/chat-run-registry.service.js';
import { connectedClients } from '@/modules/websocket/services/websocket-state.service.js';
import type { ProviderSteerResult } from '@/shared/types.js';

const SESSION_ID = 'steer-session';

function createFakeSocket() {
  const socket = new EventEmitter() as EventEmitter & {
    readyState: number;
    frames: Array<Record<string, unknown>>;
    send: (data: string) => void;
  };
  socket.readyState = 1;
  socket.frames = [];
  socket.send = (data: string) => socket.frames.push(JSON.parse(data) as Record<string, unknown>);
  return socket;
}

type SteerCall = { command: string; options: Record<string, unknown>; allowNewTurn: boolean };

/**
 * A gateway whose runtime answers steers with `steerOutcome` and records every
 * steer and every ordinary run it is asked for.
 */
async function withGateway(
  setup: { steerOutcome: ProviderSteerResult; backgroundWork?: boolean },
  runTest: (context: {
    socket: ReturnType<typeof createFakeSocket>;
    steers: SteerCall[];
    runs: string[];
  }) => Promise<void>,
): Promise<void> {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const tempDirectory = await mkdtemp(path.join(os.tmpdir(), 'chat-steer-'));

  closeConnection();
  process.env.DATABASE_PATH = path.join(tempDirectory, 'auth.db');
  await initializeDatabase();

  const steers: SteerCall[] = [];
  const runs: string[] = [];
  const socket = createFakeSocket();

  try {
    sessionsDb.createAppSession(SESSION_ID, 'claude', tempDirectory);

    handleChatConnection(
      socket as never,
      { user: { id: 1 } } as never,
      {
        runtime: {
          hasRuntime: () => true,
          hasBackgroundWork: () => Boolean(setup.backgroundWork),
          steer: async (
            _provider: string,
            _sessionId: string,
            command: string,
            options: Record<string, unknown>,
            steerOptions: { allowNewTurn: boolean },
          ) => {
            steers.push({ command, options, allowNewTurn: steerOptions.allowNewTurn });
            return setup.steerOutcome;
          },
          run: async (_provider: string, command: string, _options: unknown, writer: { send: (message: unknown) => void }) => {
            runs.push(command);
            writer.send({ kind: 'complete', exitCode: 0, provider: 'claude', sessionId: SESSION_ID });
          },
        } as never,
      },
    );

    await runTest({ socket, steers, runs });
  } finally {
    connectedClients.clear();
    chatRunRegistry.clearAll();
    closeConnection();
    if (previousDatabasePath === undefined) {
      delete process.env.DATABASE_PATH;
    } else {
      process.env.DATABASE_PATH = previousDatabasePath;
    }
    await rm(tempDirectory, { recursive: true, force: true });
  }
}

const settle = () => new Promise((resolve) => { setTimeout(resolve, 30); });

function startRunningTurn(): NonNullable<ReturnType<typeof chatRunRegistry.startRun>> {
  const run = chatRunRegistry.startRun({
    appSessionId: SESSION_ID,
    provider: 'claude',
    providerSessionId: null,
    connection: null,
    userId: 1,
  });
  assert.ok(run);
  return run;
}

test('a steer during a running turn goes into the live process', async () => {
  await withGateway({ steerOutcome: { delivered: true, newTurn: false } }, async ({ socket, steers, runs }) => {
    startRunningTurn();
    socket.emit('message', JSON.stringify({
      type: 'chat.steer',
      sessionId: SESSION_ID,
      content: 'change course',
      options: { attachments: [{ path: '/etc/passwd', name: 'passwd' }] },
    }));
    await settle();

    assert.equal(steers.length, 1);
    assert.equal(steers[0].command, 'change course');
    assert.equal(steers[0].allowNewTurn, false);
    assert.deepEqual(steers[0].options.attachments, [], 'attachments outside the upload store are dropped');
    assert.deepEqual(runs, []);
    assert.deepEqual(socket.frames, []);
    assert.equal(chatRunRegistry.isProcessing(SESSION_ID), true);
  });
});

test('a steer over background work starts a new turn and reopens the run', async () => {
  await withGateway({ steerOutcome: { delivered: true, newTurn: true }, backgroundWork: true }, async ({ socket, steers }) => {
    const run = startRunningTurn();
    run.writer.sendComplete({ exitCode: 0 });
    assert.equal(chatRunRegistry.isProcessing(SESSION_ID), false);

    socket.emit('message', JSON.stringify({ type: 'chat.steer', sessionId: SESSION_ID, content: 'next question' }));
    await settle();

    assert.equal(steers[0].allowNewTurn, true);
    assert.equal(chatRunRegistry.isProcessing(SESSION_ID), true, 'busy until the new turn completes');
  });
});

test('a steer with nothing live to steer is sent as an ordinary turn', async () => {
  await withGateway({ steerOutcome: { delivered: false, newTurn: false } }, async ({ socket, steers, runs }) => {
    socket.emit('message', JSON.stringify({ type: 'chat.steer', sessionId: SESSION_ID, content: 'hello' }));
    await settle();

    assert.deepEqual(steers, []);
    assert.deepEqual(runs, ['hello']);
  });
});

test('a running turn that cannot take the steer reports STEER_UNAVAILABLE and sends nothing', async () => {
  await withGateway({ steerOutcome: { delivered: false, newTurn: false } }, async ({ socket, runs }) => {
    startRunningTurn();
    socket.emit('message', JSON.stringify({ type: 'chat.steer', sessionId: SESSION_ID, content: 'hello' }));
    await settle();

    assert.deepEqual(runs, []);
    assert.equal(socket.frames.at(-1)?.code, 'STEER_UNAVAILABLE');
    assert.equal(chatRunRegistry.isProcessing(SESSION_ID), true);
  });
});
