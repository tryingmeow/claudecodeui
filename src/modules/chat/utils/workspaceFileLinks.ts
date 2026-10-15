/**
 * Helpers for workspace file references in model-authored markdown, shared by
 * the image renderer and the link renderer so both resolve a path the same way.
 */

// Turn a markdown link or image destination into the path the file-tree route
// expects. Relative paths are resolved against the project root server-side;
// absolute paths are accepted as long as they stay inside it.
//
// The markdown parser percent-encodes destinations (`<outputs/体检 报告.docx>`
// arrives as `outputs/%E4%BD%93%E6%A3%80%20...`), and models sometimes write
// them encoded already, so the path is decoded once before it is sent.
export const toWorkspacePath = (reference: string): string => {
  let workspacePath = reference.trim();
  if (workspacePath.startsWith('file://')) {
    workspacePath = workspacePath.slice('file://'.length);
  }
  if (workspacePath.startsWith('./')) {
    workspacePath = workspacePath.slice(2);
  }
  try {
    workspacePath = decodeURIComponent(workspacePath);
  } catch {
    // Keep the raw value when it is not valid percent-encoding.
  }
  return workspacePath;
};

/** The last path segment, which is also the name a download is saved under. */
export const workspaceFileName = (workspacePath: string): string =>
  workspacePath.split(/[\\/]/).filter(Boolean).pop() ?? workspacePath;

export type DeliverableFileKind = 'document' | 'spreadsheet' | 'presentation' | 'archive' | 'image' | 'audio' | 'video';

// Files a non-programmer saves and opens in another app rather than reads as
// code. Anything not listed (source, config, markdown, plain text) keeps
// opening in the code editor.
const DELIVERABLE_EXTENSIONS = new Map<string, DeliverableFileKind>(Object.entries({
  pdf: 'document',
  doc: 'document',
  docx: 'document',
  dot: 'document',
  dotx: 'document',
  rtf: 'document',
  odt: 'document',
  pages: 'document',
  wps: 'document',
  epub: 'document',
  xls: 'spreadsheet',
  xlsx: 'spreadsheet',
  xlsm: 'spreadsheet',
  ods: 'spreadsheet',
  numbers: 'spreadsheet',
  et: 'spreadsheet',
  csv: 'spreadsheet',
  tsv: 'spreadsheet',
  ppt: 'presentation',
  pptx: 'presentation',
  pps: 'presentation',
  ppsx: 'presentation',
  odp: 'presentation',
  dps: 'presentation',
  zip: 'archive',
  rar: 'archive',
  '7z': 'archive',
  tar: 'archive',
  gz: 'archive',
  tgz: 'archive',
  bz2: 'archive',
  xz: 'archive',
  png: 'image',
  jpg: 'image',
  jpeg: 'image',
  gif: 'image',
  webp: 'image',
  bmp: 'image',
  heic: 'image',
  heif: 'image',
  tif: 'image',
  tiff: 'image',
  svg: 'image',
  mp3: 'audio',
  wav: 'audio',
  m4a: 'audio',
  aac: 'audio',
  ogg: 'audio',
  oga: 'audio',
  flac: 'audio',
  opus: 'audio',
  amr: 'audio',
  mp4: 'video',
  mov: 'video',
  m4v: 'video',
  avi: 'video',
  mkv: 'video',
  webm: 'video',
  '3gp': 'video',
  wmv: 'video',
  flv: 'video',
} satisfies Record<string, DeliverableFileKind>));

/**
 * What kind of deliverable a link points at, or null when the reference is a
 * directory or a file that belongs in the code editor.
 */
export const deliverableFileKind = (reference: string): DeliverableFileKind | null => {
  const workspacePath = toWorkspacePath(reference);
  if (!workspacePath || /[\\/]$/.test(workspacePath)) {
    return null;
  }
  const extension = workspaceFileName(workspacePath).match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase();
  return extension ? DELIVERABLE_EXTENSIONS.get(extension) ?? null : null;
};
