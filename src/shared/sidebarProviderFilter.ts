import type { LLMProvider } from '@/shared/types';
import { readUserPreference, writeUserPreference } from '@/shared/userSettings';

/**
 * The sidebar's "show only these CLIs" filter.
 *
 * Deliberately a preference of its own, not `selectedProvider`: that one is the
 * chat composer's send target, and sharing it would make narrowing the sidebar
 * silently change which CLI the next message goes to.
 *
 * Stored through the preference store like every other setting, so the choice
 * follows the user between devices. Filtering happens on the server (rows and
 * counts alike), so every list request carries the current selection as a
 * comma-separated `provider` query parameter.
 */

/** Every CLI the sidebar can list sessions for, in display order. */
export const SIDEBAR_FILTER_PROVIDERS: readonly LLMProvider[] = ['claude', 'codex', 'cursor', 'opencode'];

const isFilterProvider = (value: unknown): value is LLMProvider =>
  typeof value === 'string' && (SIDEBAR_FILTER_PROVIDERS as readonly string[]).includes(value);

/** Drops unknown ids and duplicates and keeps display order, so the query string is stable. */
const normalizeProviderFilter = (value: unknown): LLMProvider[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  const selected = new Set(value.filter(isFilterProvider));
  return SIDEBAR_FILTER_PROVIDERS.filter((provider) => selected.has(provider));
};

/** Current selection; an empty array means no filter, i.e. every provider. */
export function readSidebarProviderFilter(): LLMProvider[] {
  return normalizeProviderFilter(readUserPreference<unknown>('sidebarProviderFilter', []));
}

/** Stable string identity of the selection ('' when unfiltered), for effect dependencies. */
export function readSidebarProviderFilterKey(): string {
  return readSidebarProviderFilter().join(',');
}

/** Value for the `provider` query parameter, or `undefined` when nothing is selected. */
export function readSidebarProviderFilterParam(): string | undefined {
  return readSidebarProviderFilterKey() || undefined;
}

/** True when an active filter excludes this provider's sessions from the sidebar. */
export function isProviderHiddenBySidebarFilter(provider: LLMProvider): boolean {
  const filter = readSidebarProviderFilter();
  return filter.length > 0 && !filter.includes(provider);
}

export function writeSidebarProviderFilter(next: LLMProvider[]): void {
  writeUserPreference('sidebarProviderFilter', normalizeProviderFilter(next));
}

export function toggleSidebarProviderFilter(provider: LLMProvider): void {
  const current = readSidebarProviderFilter();
  writeSidebarProviderFilter(
    current.includes(provider)
      ? current.filter((candidate) => candidate !== provider)
      : [...current, provider],
  );
}
