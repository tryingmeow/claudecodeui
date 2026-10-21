import assert from 'node:assert/strict';
import test from 'node:test';

import { ClaudeSessionsProvider } from '@/modules/providers/list/claude/claude-sessions.provider.js';

/**
 * A message the user sent while a turn was running is recorded by the Claude
 * CLI as a `queued_command` attachment where the turn read it, not as a `user`
 * row. History has to show it as the user's message at that point.
 */

const sessions = new ClaudeSessionsProvider({ getLiveRunStartTime: () => null });

const queuedCommand = (attachment: Record<string, unknown>) => ({
  type: 'attachment',
  uuid: 'row-uuid-1',
  parentUuid: 'tool-result-uuid',
  timestamp: '2026-10-21T08:50:53.000Z',
  sessionId: 'native-1',
  attachment: { type: 'queued_command', source_uuid: 'source-1', ...attachment },
});

test('a steered prompt renders as a user message without an edit anchor', () => {
  const messages = sessions.normalizeMessage(
    queuedCommand({ prompt: 'Also mention BANANA.', commandMode: 'prompt' }),
    'app-1',
  );

  assert.equal(messages.length, 1);
  assert.equal(messages[0]?.kind, 'text');
  assert.equal(messages[0]?.role, 'user');
  assert.equal(messages[0]?.content, 'Also mention BANANA.');
  assert.equal(messages[0]?.transcriptAnchorId, undefined, 'a mid-turn message is not a point to replay from');
});

test('a steered prompt with an image keeps the image on the bubble', () => {
  const messages = sessions.normalizeMessage(
    queuedCommand({
      commandMode: 'prompt',
      prompt: [
        { type: 'text', text: 'look at this' },
        { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAAA' } },
      ],
    }),
    'app-1',
  );

  assert.equal(messages.length, 1);
  assert.equal(messages[0]?.content, 'look at this');
  assert.deepEqual(messages[0]?.images, [{ data: 'data:image/png;base64,AAAA' }]);
});

test('a background-task report filed as a queued command stays hidden', () => {
  const messages = sessions.normalizeMessage(
    queuedCommand({ prompt: '<task-notification>done</task-notification>', commandMode: 'task-notification' }),
    'app-1',
  );

  assert.deepEqual(messages, []);
});
