import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  DownloadIcon,
  FileArchiveIcon,
  FileAudioIcon,
  FileImageIcon,
  FileSpreadsheetIcon,
  FileTextIcon,
  FileVideoIcon,
  LoaderCircleIcon,
  PresentationIcon,
  RotateCwIcon,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

import { api } from '@/shared/api';
import { useMarkdownWorkspaceProjectId } from '@/modules/chat/context/MarkdownWorkspaceContext';
import {
  deliverableFileKind,
  toWorkspacePath,
  workspaceFileName,
  type DeliverableFileKind,
} from '@/modules/chat/utils/workspaceFileLinks';

const KIND_ICONS: Record<DeliverableFileKind, LucideIcon> = {
  document: FileTextIcon,
  spreadsheet: FileSpreadsheetIcon,
  presentation: PresentationIcon,
  archive: FileArchiveIcon,
  image: FileImageIcon,
  audio: FileAudioIcon,
  video: FileVideoIcon,
};

// iOS Safari reads the blob only after click() returns, so revoking the URL at
// once cancels the download there. A minute covers any realistic hand-off.
const OBJECT_URL_LIFETIME_MS = 60_000;

/** Hands a fetched file to the browser's download manager under its real name. */
function saveBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.rel = 'noopener';
  anchor.style.display = 'none';
  // Attached for the click: some mobile browsers ignore clicks on detached anchors.
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), OBJECT_URL_LIFETIME_MS);
}

type DownloadState = 'idle' | 'loading' | 'failed';

type MarkdownFileCardProps = {
  /** The link destination as the model wrote it (relative to the project root, or absolute inside it). */
  reference: string;
};

/**
 * Tappable card for a link to a deliverable file (document, sheet, archive,
 * media) in chat markdown. Tapping downloads the file to the device instead of
 * opening it as code. A bare href cannot carry the auth header, so the bytes
 * come through the authenticated files route, as MarkdownImage does.
 */
export function MarkdownFileCard({ reference }: MarkdownFileCardProps) {
  const { t } = useTranslation('chat');
  const projectId = useMarkdownWorkspaceProjectId();
  const [state, setState] = useState<DownloadState>('idle');
  const controllerRef = useRef<AbortController | null>(null);

  const workspacePath = toWorkspacePath(reference);
  const fileName = workspaceFileName(workspacePath);
  const KindIcon = KIND_ICONS[deliverableFileKind(reference) ?? 'document'];

  useEffect(() => () => controllerRef.current?.abort(), []);

  const download = async () => {
    if (state === 'loading') {
      return;
    }
    if (!projectId) {
      setState('failed');
      return;
    }

    const controller = new AbortController();
    controllerRef.current = controller;
    setState('loading');
    try {
      const response = await api.readFileBlob(projectId, workspacePath, { signal: controller.signal });
      if (!response.ok) {
        setState('failed');
        return;
      }
      const blob = await response.blob();
      if (controller.signal.aborted) {
        return;
      }
      saveBlob(blob, fileName);
      setState('idle');
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        return;
      }
      console.error(`Failed to download "${workspacePath}":`, error);
      setState('failed');
    }
  };

  const statusLabel = state === 'loading'
    ? t('fileCard.downloading')
    : state === 'failed'
      ? t('fileCard.failed')
      : t('fileCard.download');
  const StatusIcon = state === 'loading' ? LoaderCircleIcon : state === 'failed' ? RotateCwIcon : DownloadIcon;

  return (
    <button
      type="button"
      onClick={() => void download()}
      aria-busy={state === 'loading'}
      aria-label={t('fileCard.ariaLabel', { name: fileName })}
      title={workspacePath}
      className="my-1 inline-flex w-72 max-w-full items-center gap-3 rounded-xl border border-border/60 bg-card px-3 py-2.5 text-left align-middle shadow-sm transition-colors hover:bg-accent/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 active:bg-accent"
    >
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
        <KindIcon className="h-5 w-5" aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="line-clamp-2 break-all text-sm font-medium text-foreground">{fileName}</span>
        <span
          className={`mt-0.5 flex items-center gap-1 text-xs ${state === 'failed' ? 'text-destructive' : 'text-muted-foreground'}`}
          aria-live="polite"
        >
          <StatusIcon className={`h-3.5 w-3.5 shrink-0 ${state === 'loading' ? 'animate-spin' : ''}`} aria-hidden="true" />
          {statusLabel}
        </span>
      </span>
    </button>
  );
}
