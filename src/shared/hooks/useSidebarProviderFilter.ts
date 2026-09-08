import { useMemo, useSyncExternalStore } from 'react';

import {
  readSidebarProviderFilterKey,
  toggleSidebarProviderFilter,
} from '@/shared/sidebarProviderFilter';
import { subscribeToUserPreferences } from '@/shared/userSettings';
import type { LLMProvider } from '@/shared/types';

/**
 * Subscribes to the sidebar CLI filter. Used by the project-workspace module
 * (project list and session pages) and the sidebar module (archive, recent
 * conversations and the filter row itself), which live in different subtrees.
 *
 * `providerFilterKey` is a primitive, so a preference hydrate or an unrelated
 * preference write that leaves the selection unchanged does not re-render or
 * re-fetch anything.
 */
export function useSidebarProviderFilter() {
  const providerFilterKey = useSyncExternalStore(
    subscribeToUserPreferences,
    readSidebarProviderFilterKey,
    readSidebarProviderFilterKey,
  );

  const providerFilter = useMemo(
    () => (providerFilterKey ? (providerFilterKey.split(',') as LLMProvider[]) : []),
    [providerFilterKey],
  );

  return {
    providerFilter,
    providerFilterKey,
    toggleProvider: toggleSidebarProviderFilter,
  };
}
