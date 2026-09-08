import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

import {
  CODEX_PREDEFINED_MODELS,
  parseCodexModelListResult,
} from '@/modules/providers/list/codex/codex-models.provider.js';

const require = createRequire(import.meta.url);

const findCodexModel = (value: string) =>
  CODEX_PREDEFINED_MODELS.OPTIONS.find((option) => option.value === value);

test('lists GPT-6 Sol and GPT-6 Luna with the effort levels the Codex CLI accepts', () => {
  const sol = findCodexModel('gpt-6-sol');
  assert.equal(sol?.label, 'GPT-6 Sol');
  assert.equal(sol?.effort?.default, 'medium');
  assert.deepEqual(
    sol?.effort?.values.map((effort) => effort.value),
    ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'],
  );

  const luna = findCodexModel('gpt-6-luna');
  assert.equal(luna?.label, 'GPT-6 Luna');
  assert.equal(luna?.effort?.default, 'medium');
  assert.deepEqual(
    luna?.effort?.values.map((effort) => effort.value),
    ['low', 'medium', 'high', 'xhigh', 'max'],
  );
});

test('bundles a Codex CLI new enough to know the GPT-6 Sol and Luna models', () => {
  // Codex only ships metadata for gpt-6-sol / gpt-6-luna from 0.155.0 on. An
  // older CLI still sends the request, but on fallback metadata: it warns
  // "Model metadata ... not found" and quietly drops `ultra` to `medium`.
  const { version } = require('@openai/codex/package.json') as { version: string };
  const [major, minor] = version.split('.').map(Number);
  assert.ok(major > 0 || minor >= 155, `bundled @openai/codex ${version} predates 0.155.0`);
});

test('maps app-server model/list entries and skips hidden ones', () => {
  const parsed = parseCodexModelListResult({
    data: [
      {
        id: 'gpt-6-astra',
        model: 'gpt-6-astra',
        displayName: 'GPT-6 Astra',
        description: 'Live description',
        hidden: false,
        isDefault: true,
        defaultReasoningEffort: 'medium',
        supportedReasoningEfforts: [
          { reasoningEffort: 'low', description: 'Fast' },
          { reasoningEffort: 'medium', description: '' },
        ],
      },
      { id: 'internal-model', displayName: 'Internal', hidden: true, supportedReasoningEfforts: [] },
      // No live efforts: the curated entry for the same id supplies them.
      { id: 'gpt-6-luna', displayName: 'GPT-6 Luna', hidden: false, supportedReasoningEfforts: [] },
    ],
  });

  assert.deepEqual(parsed.options.map((option) => option.value), ['gpt-6-astra', 'gpt-6-luna']);
  assert.equal(parsed.defaultValue, 'gpt-6-astra');
  assert.deepEqual(parsed.options[0].effort, {
    default: 'medium',
    values: [{ value: 'low', description: 'Fast' }, { value: 'medium' }],
  });
  assert.deepEqual(parsed.options[1].effort, findCodexModel('gpt-6-luna')?.effort);
});
