import assert from 'node:assert/strict';

import { beforeEach, test } from 'vitest';

import { readSelectedProvider } from '@/shared/selectedProvider';
import {
  isProviderHiddenBySidebarFilter,
  readSidebarProviderFilter,
  readSidebarProviderFilterParam,
  toggleSidebarProviderFilter,
} from '@/shared/sidebarProviderFilter';
import { resetUserPreferences, writeUserPreference } from '@/shared/userSettings';

beforeEach(() => {
  localStorage.clear();
  resetUserPreferences();
});

test('an unset filter shows every provider and sends no query parameter', () => {
  assert.deepEqual(readSidebarProviderFilter(), []);
  assert.equal(readSidebarProviderFilterParam(), undefined);
  assert.equal(isProviderHiddenBySidebarFilter('cursor'), false);
});

test('toggling keeps display order regardless of click order', () => {
  toggleSidebarProviderFilter('cursor');
  toggleSidebarProviderFilter('claude');
  assert.equal(readSidebarProviderFilterParam(), 'claude,cursor');
  assert.equal(isProviderHiddenBySidebarFilter('codex'), true);
  assert.equal(isProviderHiddenBySidebarFilter('cursor'), false);

  toggleSidebarProviderFilter('claude');
  assert.deepEqual(readSidebarProviderFilter(), ['cursor']);
});

test('unknown ids and duplicates in a stored value are dropped', () => {
  writeUserPreference('sidebarProviderFilter', ['codex', 'nope', 'codex', 42]);
  assert.deepEqual(readSidebarProviderFilter(), ['codex']);

  writeUserPreference('sidebarProviderFilter', 'codex');
  assert.deepEqual(readSidebarProviderFilter(), []);
});

test('the filter never changes the chat send target', () => {
  toggleSidebarProviderFilter('opencode');
  assert.equal(readSelectedProvider(), 'claude');
});
