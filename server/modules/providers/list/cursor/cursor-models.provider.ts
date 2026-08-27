import { access, readdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import spawn from 'cross-spawn';

import type { IProviderModels } from '@/shared/interfaces.js';
import type {
  ProviderCurrentActiveModel,
  ProviderModelsDefinition,
} from '@/shared/types.js';
import {
  buildDefaultProviderCurrentActiveModel,
  sanitizeLeafDirectoryName,
} from '@/shared/utils.js';

/** Curated Cursor catalog shipped as immutable CloudCLI defaults. */
export const CURSOR_PREDEFINED_MODELS: ProviderModelsDefinition = {
  OPTIONS: [
    { value: 'auto', label: 'Auto', description: 'Let Cursor choose the model.' },
    {
      value: 'composer-2.5-fast',
      label: 'Composer 2.5 Fast',
      description: 'Cursor Composer 2.5 with faster inference.',
    },
    {
      value: 'composer-2.5',
      label: 'Composer 2.5',
      description: 'Cursor model for efficient, long-running coding tasks.',
    },
    { value: 'gpt-5.6-sol', label: 'GPT-5.6 Sol' },
    { value: 'gpt-5.6-terra', label: 'GPT-5.6 Terra' },
    { value: 'gpt-5.6-luna', label: 'GPT-5.6 Luna' },
    { value: 'gpt-5.5', label: 'GPT-5.5' },
    { value: 'claude-fable-5', label: 'Claude Fable 5' },
    { value: 'claude-opus-5', label: 'Claude Opus 5' },
    { value: 'claude-opus-4-8', label: 'Claude Opus 4.8' },
    { value: 'claude-sonnet-5', label: 'Claude Sonnet 5' },
    { value: 'grok-4.5', label: 'Grok 4.5' },
    { value: 'gemini-3.1-pro', label: 'Gemini 3.1 Pro' },
    { value: 'kimi-k2.5', label: 'Kimi K2.5' },
  ],
  DEFAULT: 'auto',
};

const CURSOR_CHATS_ROOT = path.join(os.homedir(), '.cursor', 'chats');

/** `cursor-agent models` prints one `<id> - <label>` pair per line, e.g. `grok-4.6 - Grok 4.6`. */
const CURSOR_MODELS_LINE_PATTERN = /^([a-zA-Z0-9_.:-]+)\s+-\s+(.+)$/;
const CURSOR_LIVE_MODELS_TIMEOUT_MS = 8000;
const CURSOR_LIVE_MODELS_CACHE_TTL_MS = 5 * 60 * 1000;

let cursorLiveModelsCache: { options: ProviderModelsDefinition['OPTIONS']; fetchedAt: number } | null = null;

const parseCursorModelsOutput = (stdout: string): ProviderModelsDefinition['OPTIONS'] => {
  const options: ProviderModelsDefinition['OPTIONS'] = [];
  for (const rawLine of stdout.split(/\r?\n/)) {
    const match = CURSOR_MODELS_LINE_PATTERN.exec(rawLine.trim());
    if (!match) {
      continue;
    }
    const [, value, label] = match;
    options.push({ value, label: label.trim() });
  }
  return options;
};

/** Runs `cursor-agent models` and parses its output; resolves null on any failure so callers fall back to the curated list. */
const fetchCursorModelsLive = (): Promise<ProviderModelsDefinition['OPTIONS'] | null> =>
  new Promise((resolve) => {
    let settled = false;
    const finish = (result: ProviderModelsDefinition['OPTIONS'] | null) => {
      if (settled) {
        return;
      }
      settled = true;
      resolve(result);
    };

    let child: ReturnType<typeof spawn>;
    try {
      child = spawn('cursor-agent', ['models'], { stdio: ['ignore', 'pipe', 'ignore'] });
    } catch {
      finish(null);
      return;
    }

    const timeout = setTimeout(() => {
      child.kill();
      finish(null);
    }, CURSOR_LIVE_MODELS_TIMEOUT_MS);

    let stdout = '';
    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
    });
    child.on('error', () => {
      clearTimeout(timeout);
      finish(null);
    });
    child.on('close', (code) => {
      clearTimeout(timeout);
      if (code !== 0) {
        finish(null);
        return;
      }
      const options = parseCursorModelsOutput(stdout);
      finish(options.length > 0 ? options : null);
    });
  });

/** Live catalog with a short cache, falling back to {@link CURSOR_PREDEFINED_MODELS} when the CLI call fails or is stale-cold. */
const resolveCursorModels = async (): Promise<ProviderModelsDefinition> => {
  const now = Date.now();
  if (cursorLiveModelsCache && now - cursorLiveModelsCache.fetchedAt < CURSOR_LIVE_MODELS_CACHE_TTL_MS) {
    return { OPTIONS: cursorLiveModelsCache.options, DEFAULT: CURSOR_PREDEFINED_MODELS.DEFAULT };
  }

  const liveOptions = await fetchCursorModelsLive();
  if (liveOptions) {
    cursorLiveModelsCache = { options: liveOptions, fetchedAt: now };
    return { OPTIONS: liveOptions, DEFAULT: CURSOR_PREDEFINED_MODELS.DEFAULT };
  }

  return CURSOR_PREDEFINED_MODELS;
};

const resolveCursorSessionStorePath = async (sessionId: string): Promise<string | null> => {
  const safeSessionId = sanitizeLeafDirectoryName(sessionId, 'cursor session id');

  try {
    const workspaceEntries = await readdir(CURSOR_CHATS_ROOT, { withFileTypes: true });
    for (const workspaceEntry of workspaceEntries) {
      if (!workspaceEntry.isDirectory()) {
        continue;
      }

      const storeDbPath = path.join(CURSOR_CHATS_ROOT, workspaceEntry.name, safeSessionId, 'store.db');
      try {
        await access(storeDbPath);
        return storeDbPath;
      } catch {
        // Keep scanning sibling workspaces until the matching session directory is found.
      }
    }
  } catch {
    return null;
  }

  return null;
};

/** Provider registry model adapter for Cursor predefined models and session metadata. */
export class CursorProviderModels implements IProviderModels {
  async getSupportedModels(): Promise<ProviderModelsDefinition> {
    return resolveCursorModels();
  }

  async getCurrentActiveModel(sessionId?: string): Promise<ProviderCurrentActiveModel> {
    const supportedModels = await this.getSupportedModels();

    if (!sessionId?.trim()) {
      return buildDefaultProviderCurrentActiveModel(supportedModels);
    }

    try {
      const storeDbPath = await resolveCursorSessionStorePath(sessionId);
      if (!storeDbPath) {
        return buildDefaultProviderCurrentActiveModel(supportedModels);
      }

      const { default: Database } = await import('better-sqlite3');
      const db = new Database(storeDbPath, { readonly: true, fileMustExist: true });

      try {
        const row = db.prepare(`SELECT value FROM meta WHERE key='0' LIMIT 1;`).get() as {
          value?: Buffer | string;
        } | undefined;
        const metadataText = Buffer.isBuffer(row?.value)
          ? row.value.toString('utf8')
          : typeof row?.value === 'string' && row.value.trim()
            ? Buffer.from(row.value.trim(), 'hex').toString('utf8')
            : '';
        if (!metadataText) {
          return buildDefaultProviderCurrentActiveModel(CURSOR_PREDEFINED_MODELS);
        }

        const metadata = JSON.parse(metadataText) as { lastUsedModel?: string };
        if (typeof metadata.lastUsedModel === 'string' && metadata.lastUsedModel.trim()) {
          return {
            model: metadata.lastUsedModel.trim(),
          };
        }
      } finally {
        db.close();
      }
    } catch {
      // Fall through to the curated default when Cursor metadata cannot be read.
    }

    return buildDefaultProviderCurrentActiveModel(supportedModels);
  }
}
