import assert from 'node:assert/strict';

import { fireEvent, render, waitFor } from '@testing-library/react';
import { beforeEach, test, vi } from 'vitest';

import { Markdown } from '@/modules/chat/transcript/Markdown';
import { MarkdownWorkspaceContext } from '@/modules/chat/context/MarkdownWorkspaceContext';

const readFileBlob = vi.fn();
vi.mock('@/shared/api', () => ({
  api: {
    readFileBlob: (...args: unknown[]) => readFileBlob(...args),
  },
}));

URL.createObjectURL = vi.fn(() => 'blob:mock-file');
URL.revokeObjectURL = vi.fn();

beforeEach(() => {
  readFileBlob.mockReset();
});

const renderInProject = (markdown: string) =>
  render(
    <MarkdownWorkspaceContext.Provider value={{ projectId: 'project-1' }}>
      <Markdown>{markdown}</Markdown>
    </MarkdownWorkspaceContext.Provider>,
  );

test('a link to a docx renders as a card and tapping it downloads the file under its own name', async () => {
  readFileBlob.mockResolvedValue({ ok: true, blob: async () => new Blob(['docx']) });
  let savedName: string | null = null;
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    savedName = this.download;
  });

  const { container } = renderInProject('[体检报告解读.docx](<outputs/体检 报告解读.docx>)');

  const card = container.querySelector('button')!;
  assert.ok(card.textContent?.includes('体检 报告解读.docx'));
  fireEvent.click(card);

  await waitFor(() => assert.equal(click.mock.calls.length, 1));
  assert.deepEqual(readFileBlob.mock.calls[0].slice(0, 2), ['project-1', 'outputs/体检 报告解读.docx']);
  assert.equal(savedName, '体检 报告解读.docx');
  click.mockRestore();
});

test('a link wrapped around an image stays an image, not a card', async () => {
  readFileBlob.mockResolvedValue({ ok: true, blob: async () => new Blob(['png']) });

  const { container } = renderInProject('[![图](<outputs/a.png>)](<outputs/a.png>)');

  await waitFor(() => assert.ok(container.querySelector('img')));
  // The card prints the file name; the inline image does not.
  assert.ok(!container.textContent?.includes('a.png'));
});

test('code-ish files do not become cards', () => {
  const { container } = renderInProject('[run.py](scripts/run.py)');
  assert.ok(container.querySelector('button') === null);
});
