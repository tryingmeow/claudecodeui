import { readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import TOML from '@iarna/toml';

import { codexAppServer } from '@/modules/providers/list/codex/codex-app-server.client.js';
import type { IProviderModels } from '@/shared/interfaces.js';
import type {
  ProviderCurrentActiveModel,
  ProviderModelOption,
  ProviderModelsDefinition,
} from '@/shared/types.js';
import {
  buildDefaultProviderCurrentActiveModel,
  readObjectRecord,
  readOptionalString,
} from '@/shared/utils.js';

/** Curated Codex catalog shipped as immutable CloudCLI defaults. */
export const CODEX_PREDEFINED_MODELS: ProviderModelsDefinition = {
  OPTIONS: [
    {
      value: 'gpt-6-astra',
      label: 'GPT-6 Astra',
      description: 'Our most capable model for complex, demanding work.',
      effort: {
        default: 'low',
        values: [
          { value: 'low' },
          { value: 'medium' },
          { value: 'high' },
          { value: 'xhigh' },
          { value: 'max' },
          { value: 'ultra' },
        ],
      },
    },
    {
      value: 'gpt-6-sol',
      label: 'GPT-6 Sol',
      description: 'Workhorse model for coding and everyday work.',
      effort: {
        default: 'medium',
        values: [
          { value: 'low' },
          { value: 'medium' },
          { value: 'high' },
          { value: 'xhigh' },
          { value: 'max' },
          { value: 'ultra' },
        ],
      },
    },
    {
      value: 'gpt-6-luna',
      label: 'GPT-6 Luna',
      description: 'Fast and affordable model for easier tasks.',
      effort: {
        default: 'medium',
        values: [
          { value: 'low' },
          { value: 'medium' },
          { value: 'high' },
          { value: 'xhigh' },
          { value: 'max' },
        ],
      },
    },
    {
      value: 'gpt-5.6-sol',
      label: 'GPT-5.6 Sol',
      description: 'Latest frontier agentic coding model.',
      effort: {
        default: 'low',
        values: [
          { value: 'low' },
          { value: 'medium' },
          { value: 'high' },
          { value: 'xhigh' },
          { value: 'max' },
          { value: 'ultra' },
        ],
      },
    },
    {
      value: 'gpt-5.6-terra',
      label: 'GPT-5.6 Terra',
      description: 'Balanced agentic coding model for everyday work.',
      effort: {
        default: 'medium',
        values: [
          { value: 'low' },
          { value: 'medium' },
          { value: 'high' },
          { value: 'xhigh' },
          { value: 'max' },
          { value: 'ultra' },
        ],
      },
    },
    {
      value: 'gpt-5.6-luna',
      label: 'GPT-5.6 Luna',
      description: 'Fast and affordable agentic coding model.',
      effort: {
        default: 'medium',
        values: [
          { value: 'low' },
          { value: 'medium' },
          { value: 'high' },
          { value: 'xhigh' },
          { value: 'max' },
        ],
      },
    },
    {
      value: 'gpt-5.5',
      label: 'GPT-5.5',
      description: 'Frontier model for complex coding, research, and real-world work.',
      effort: {
        default: 'medium',
        values: [{ value: 'low' }, { value: 'medium' }, { value: 'high' }, { value: 'xhigh' }],
      },
    },
    {
      value: 'gpt-5.4',
      label: 'GPT-5.4',
      description: 'Strong model for everyday coding.',
      effort: {
        default: 'medium',
        values: [{ value: 'low' }, { value: 'medium' }, { value: 'high' }, { value: 'xhigh' }],
      },
    },
    {
      value: 'gpt-5.4-mini',
      label: 'GPT-5.4 Mini',
      description: 'Small, fast, and cost-efficient model for simpler coding tasks.',
      effort: {
        default: 'medium',
        values: [{ value: 'low' }, { value: 'medium' }, { value: 'high' }, { value: 'xhigh' }],
      },
    },
  ],
  DEFAULT: 'gpt-5.6-sol',
};

const CODEX_CONFIG_PATH = path.join(os.homedir(), '.codex', 'config.toml');

const CODEX_LIVE_MODELS_TIMEOUT_MS = 10000;
const CODEX_LIVE_MODELS_CACHE_TTL_MS = 5 * 60 * 1000;
/** After a failed live fetch the curated list is served this long before the next attempt. */
const CODEX_LIVE_MODELS_FAILURE_TTL_MS = 60 * 1000;

let codexLiveModelsCache: { models: CodexLiveModels | null; fetchedAt: number } | null = null;
/** Shared by concurrent callers so one cold cache spawns one app server, not one per request. */
let codexLiveModelsInFlight: Promise<CodexLiveModels | null> | null = null;

/** Live catalog plus the id the app server flags as `isDefault`, when it flags one. */
type CodexLiveModels = { options: ProviderModelOption[]; defaultValue: string | null };

const CODEX_PREDEFINED_EFFORT_BY_MODEL = new Map(
  CODEX_PREDEFINED_MODELS.OPTIONS.map((option) => [option.value, option.effort] as const),
);

/**
 * Maps one `model/list` entry onto a catalog option.
 *
 * Effort comes from the live payload when the app server reports it; otherwise the curated
 * entry for the same id supplies it, so the reasoning-effort selector never loses its values
 * when the protocol omits them.
 */
const toCodexModelOption = (entry: Record<string, unknown>): ProviderModelOption | null => {
  const value = readOptionalString(entry.id) ?? readOptionalString(entry.model);
  if (!value) {
    return null;
  }

  const label = readOptionalString(entry.displayName) ?? value;
  const description = readOptionalString(entry.description);

  const liveEffortValues = Array.isArray(entry.supportedReasoningEfforts)
    ? entry.supportedReasoningEfforts
        .map((rawLevel) => {
          const level = readObjectRecord(rawLevel);
          const levelValue = readOptionalString(level?.reasoningEffort);
          if (!levelValue) {
            return null;
          }
          const levelDescription = readOptionalString(level?.description);
          return levelDescription ? { value: levelValue, description: levelDescription } : { value: levelValue };
        })
        .filter((level): level is { value: string; description?: string } => level !== null)
    : [];

  const defaultEffort = readOptionalString(entry.defaultReasoningEffort);
  const effort = liveEffortValues.length > 0
    ? { ...(defaultEffort ? { default: defaultEffort } : {}), values: liveEffortValues }
    : CODEX_PREDEFINED_EFFORT_BY_MODEL.get(value);

  return {
    value,
    label,
    ...(description ? { description } : {}),
    ...(effort ? { effort } : {}),
  };
};

export const parseCodexModelListResult = (result: unknown): CodexLiveModels => {
  const record = readObjectRecord(result);
  const data = record?.data;
  if (!Array.isArray(data)) {
    return { options: [], defaultValue: null };
  }

  const options: ProviderModelOption[] = [];
  let defaultValue: string | null = null;
  for (const rawEntry of data) {
    const entry = readObjectRecord(rawEntry);
    if (!entry || entry.hidden === true) {
      continue;
    }
    const option = toCodexModelOption(entry);
    if (!option) {
      continue;
    }
    options.push(option);
    if (entry.isDefault === true && !defaultValue) {
      defaultValue = option.value;
    }
  }
  return { options, defaultValue };
};

/**
 * Asks the bundled Codex CLI's app server for `model/list`, i.e. the catalog the configured
 * account and model provider actually offer. Resolves null on any failure so callers fall back
 * to the curated list.
 */
const fetchCodexModelsLive = async (): Promise<CodexLiveModels | null> => {
  try {
    const entries = await codexAppServer.listModels({ requestTimeoutMs: CODEX_LIVE_MODELS_TIMEOUT_MS });
    const models = parseCodexModelListResult({ data: entries });
    return models.options.length > 0 ? models : null;
  } catch {
    return null;
  }
};

/** Live catalog with a short cache, falling back to {@link CODEX_PREDEFINED_MODELS} on any failure. */
const toCodexModelsDefinition = (models: CodexLiveModels): ProviderModelsDefinition => {
  const predefinedDefaultIsLive = models.options.some(
    (option) => option.value === CODEX_PREDEFINED_MODELS.DEFAULT,
  );
  return {
    OPTIONS: models.options,
    DEFAULT: predefinedDefaultIsLive
      ? CODEX_PREDEFINED_MODELS.DEFAULT
      : models.defaultValue ?? models.options[0]?.value ?? CODEX_PREDEFINED_MODELS.DEFAULT,
  };
};

const resolveCodexModels = async (): Promise<ProviderModelsDefinition> => {
  const now = Date.now();
  if (codexLiveModelsCache) {
    const { models, fetchedAt } = codexLiveModelsCache;
    const ttl = models ? CODEX_LIVE_MODELS_CACHE_TTL_MS : CODEX_LIVE_MODELS_FAILURE_TTL_MS;
    if (now - fetchedAt < ttl) {
      return models ? toCodexModelsDefinition(models) : CODEX_PREDEFINED_MODELS;
    }
  }

  if (!codexLiveModelsInFlight) {
    codexLiveModelsInFlight = fetchCodexModelsLive().finally(() => {
      codexLiveModelsInFlight = null;
    });
  }
  const liveModels = await codexLiveModelsInFlight;
  codexLiveModelsCache = { models: liveModels, fetchedAt: Date.now() };
  return liveModels ? toCodexModelsDefinition(liveModels) : CODEX_PREDEFINED_MODELS;
};

/** Provider registry model adapter for Codex predefined models and active config. */
export class CodexProviderModels implements IProviderModels {
  async getSupportedModels(): Promise<ProviderModelsDefinition> {
    return resolveCodexModels();
  }

  async getCurrentActiveModel(): Promise<ProviderCurrentActiveModel> {
    try {
      const raw = await readFile(CODEX_CONFIG_PATH, 'utf8');
      const parsed = readObjectRecord(TOML.parse(raw));
      const model = readOptionalString(parsed?.model);
      if (!model) {
        return buildDefaultProviderCurrentActiveModel(await this.getSupportedModels());
      }

      return {
        model,
      };
    } catch {
      return buildDefaultProviderCurrentActiveModel(await this.getSupportedModels());
    }
  }
}
