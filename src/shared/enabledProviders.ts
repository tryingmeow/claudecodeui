import type { LLMProvider } from '@/shared/types';

/**
 * Which CLIs this deployment offers in the UI, fixed at build time:
 * `VITE_ENABLED_PROVIDERS=claude` (comma-separated ids) builds a front end
 * that only shows Claude. Unset or empty keeps every provider.
 *
 * Front end only on purpose: the server still serves every provider, so an
 * instance can hide the CLIs its users should not pick (or that are not
 * logged in there) without forking the server.
 */
const configuredProviders = (import.meta.env?.VITE_ENABLED_PROVIDERS ?? '')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);

export const isProviderEnabled = (provider: LLMProvider): boolean =>
  configuredProviders.length === 0 || configuredProviders.includes(provider);
