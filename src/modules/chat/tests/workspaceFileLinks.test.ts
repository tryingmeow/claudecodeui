import assert from 'node:assert/strict';

import { test } from 'vitest';

import {
  deliverableFileKind,
  toWorkspacePath,
  workspaceFileName,
} from '@/modules/chat/utils/workspaceFileLinks';

test('toWorkspacePath decodes percent-encoded Chinese names and strips ./ and file://', () => {
  assert.equal(
    toWorkspacePath('outputs/%E4%BD%93%E6%A3%80%20%E6%8A%A5%E5%91%8A.docx'),
    'outputs/体检 报告.docx',
  );
  assert.equal(toWorkspacePath('./outputs/体检报告解读.docx'), 'outputs/体检报告解读.docx');
  assert.equal(toWorkspacePath('file:///home/p/outputs/a.pdf'), '/home/p/outputs/a.pdf');
  assert.equal(toWorkspacePath('outputs/100%.xlsx'), 'outputs/100%.xlsx');
});

test('workspaceFileName returns the last path segment', () => {
  assert.equal(workspaceFileName('outputs/体检 报告.docx'), '体检 报告.docx');
  assert.equal(workspaceFileName('/home/p/a.pdf'), 'a.pdf');
  assert.equal(workspaceFileName('a.pdf'), 'a.pdf');
});

test('deliverableFileKind classifies deliverables and leaves code-ish files alone', () => {
  assert.equal(deliverableFileKind('outputs/体检报告解读.docx'), 'document');
  assert.equal(deliverableFileKind('outputs/%E6%8A%A5%E5%91%8A.PDF'), 'document');
  assert.equal(deliverableFileKind('a.xlsx'), 'spreadsheet');
  assert.equal(deliverableFileKind('a.pptx'), 'presentation');
  assert.equal(deliverableFileKind('a.zip'), 'archive');
  assert.equal(deliverableFileKind('a.mp3'), 'audio');
  assert.equal(deliverableFileKind('/home/p/a.mp4'), 'video');
  for (const name of ['a.ts', 'a.py', 'README.md', 'a.txt', 'a.json', 'Makefile', 'outputs/', 'outputs']) {
    assert.equal(deliverableFileKind(name), null, name);
  }
});
