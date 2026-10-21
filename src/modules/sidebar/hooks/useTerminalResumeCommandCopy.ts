import { useCallback, useRef, useState } from 'react';
import { Check, Terminal } from 'lucide-react';
import type { TFunction } from 'i18next';

import { api } from '@/shared/api';
import type { LLMProvider } from '@/shared/types';
import { copyTextToClipboard } from '@/shared/utils';

type CopyState = 'loading' | 'idle' | 'copying' | 'copied' | 'error';

/** Providers whose CLI can resume a session by id; the backend enforces the same set. */
const TERMINAL_RESUMABLE_PROVIDERS: ReadonlySet<LLMProvider> = new Set<LLMProvider>(['claude', 'codex']);

/**
 * The "copy terminal resume command" action of a session row's menu.
 *
 * Sessions started through the SDK are hidden from the CLI's resume picker, so
 * the backend builds a `cd <project> && claude --resume <id>` command (or the
 * Codex equivalent). Like the provider-id copy, the command is fetched when the
 * menu opens — not on click — so the clipboard write still happens inside the
 * user gesture, and dropped on close so a stale command is never copied.
 *
 * `setOptionsOpen` is stable per session, as ActionMenu depends on it.
 */
export function useTerminalResumeCommandCopy(sessionId: string, provider: LLMProvider, t: TFunction) {
  const isSupported = TERMINAL_RESUMABLE_PROVIDERS.has(provider);
  const [copyState, setCopyState] = useState<CopyState>('idle');
  const [command, setCommand] = useState<string | null>(null);
  const requestRef = useRef(0);

  const load = useCallback(async () => {
    const requestId = ++requestRef.current;
    setCopyState('loading');
    try {
      const response = await api.terminalResumeCommand(sessionId);
      const payload = await response.json();
      const loadedCommand = payload?.data?.command;
      if (!response.ok || typeof loadedCommand !== 'string' || !loadedCommand) {
        throw new Error('Terminal resume command is unavailable');
      }

      if (requestId !== requestRef.current) return;
      setCommand(loadedCommand);
      setCopyState('idle');
    } catch {
      if (requestId !== requestRef.current) return;
      setCommand(null);
      setCopyState('error');
    }
  }, [sessionId]);

  const setOptionsOpen = useCallback((open: boolean) => {
    if (open && isSupported) {
      setCommand(null);
      void load();
    } else {
      requestRef.current += 1;
      setCopyState('idle');
      setCommand(null);
    }
  }, [isSupported, load]);

  const handleCopyAction = useCallback(async () => {
    // A failed fetch has nothing to copy, so the same control retries it.
    if (!command) {
      void load();
      return;
    }

    setCopyState('copying');
    const didCopy = await copyTextToClipboard(command);
    setCopyState(didCopy ? 'copied' : 'error');
  }, [command, load]);

  const copyLabel = copyState === 'loading'
    ? t('tooltips.terminalResumeLoading', { defaultValue: 'Preparing resume command…' })
    : copyState === 'copied'
      ? t('tooltips.terminalResumeCopied', { defaultValue: 'Resume command copied' })
      : copyState === 'error'
        ? command
          ? t('tooltips.terminalResumeCopyFailed', { defaultValue: "Couldn't copy resume command" })
          : t('tooltips.terminalResumeUnavailable', { defaultValue: 'Resume command unavailable' })
        : t('tooltips.terminalResumeCopy', { defaultValue: 'Copy terminal resume command' });

  return {
    isSupported,
    copyState,
    copyLabel,
    setOptionsOpen,
    handleCopyAction,
    isCopyPending: copyState === 'loading' || copyState === 'copying',
    CopyStateIcon: copyState === 'copied' ? Check : Terminal,
  };
}
