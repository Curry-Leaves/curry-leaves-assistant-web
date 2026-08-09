/** Upload images into the bundle and insert the markdown reference at the caret.
 *
 * One helper behind all four entry points (paste, drop, toolbar picker, and a pasted URL) so the
 * upload/insert/error behaviour can't drift between them. Images become real files under
 * `memory/assets/` and the note gets an ordinary relative link — see `domain/knowledge_assets.py`
 * for why that beats an inline data: URI.
 *
 * Insertion is optimistic in ordering but not in content: the markdown is written only after the
 * upload resolves, because the returned filename is chosen by the backend (it sniffs the real
 * type and de-duplicates same-day names), so we can't predict the path client-side.
 */
import { useCallback, useEffect, useState } from 'react';
import { api } from '../../../api/client';
import { htmlImagesToMarkdown } from '../../../components/noteImages';

/** Upload-in-flight state, published outside React's tree.
 *
 * The editor toolbar is constructed inside a `useMemo([])` (rebuilding it would remount MDXEditor
 * and drop the caret), so it can never receive a changing prop. A tiny external store lets the
 * button subscribe to `busy` on its own and re-render, without making the toolbar's identity
 * depend on it. */
let busyCount = 0;
const busyListeners = new Set<() => void>();
const setBusyCount = (n: number) => { busyCount = n; busyListeners.forEach((l) => l()); };

export function useUploadBusy(): boolean {
  const [busy, setBusy] = useState(busyCount > 0);
  useEffect(() => {
    const sync = () => setBusy(busyCount > 0);
    busyListeners.add(sync);
    sync();
    return () => { busyListeners.delete(sync); };
  }, []);
  return busy;
}

/** Markdown for one stored asset. Alt text defaults to the original filename's stem, which is
 *  more useful to a screen reader (and to a human reading the raw file) than an empty `![]`. */
const imageMarkdown = (path: string, alt: string) => `![${alt}](${path})`;

/** Put every image on its own line when serializing the editor back to markdown.
 *
 * Lexical treats an image as an INLINE node, so two images pasted in a row serialize as
 * `![a](x.png)![b](y.png)` on one line, and an image pasted at the end of a sentence glues
 * itself to that sentence. Both are valid CommonMark and still render — but the note becomes
 * unreadable as a plain file, which is the whole point of storing notes as markdown. Worse, an
 * image welded to a paragraph is no longer round-trip stable: the next parse folds it into that
 * paragraph, so the layout the user saw when they pasted is not what they get back.
 *
 * Splitting them here (rather than configuring the serializer) keeps the rule in one place and
 * applies no matter which path inserted the image — plugin paste/drop, our toolbar, or a URL.
 * Images inside code fences are left alone: there they are example text, not content.
 */
export function normalizeImageBlocks(md: string): string {
  md = htmlImagesToMarkdown(md);
  let inFence = false;
  return md
    .split('\n')
    .map((line) => {
      if (/^\s*(```|~~~)/.test(line)) { inFence = !inFence; return line; }
      if (inFence) return line;
      // A line carrying an image plus other content: break each image onto its own line.
      const images = line.match(/!\[[^\]]*\]\([^)]*\)/g);
      if (!images || (images.length === 1 && line.trim() === images[0])) return line;
      return line
        .replace(/(!\[[^\]]*\]\([^)]*\))/g, '\n$1\n')
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean)
        .join('\n\n');
    })
    .join('\n');
}

const altFromName = (name: string) =>
  name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ').trim() || 'image';

export function useImageInsert(insert: (markdown: string) => void) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const uploadFiles = useCallback(async (files: File[]) => {
    const images = files.filter((f) => f.type.startsWith('image/'));
    if (images.length === 0) return false;
    setBusy(true);
    setBusyCount(busyCount + 1);
    setError(null);
    try {
      // Sequential, not Promise.all: each insert goes in at the caret, and concurrent uploads
      // would race to finish out of order and scramble the sequence of a multi-image paste.
      for (const file of images) {
        try {
          const buf = await file.arrayBuffer();
          const saved = await api.uploadKnowledgeAsset(file.name || 'image', buf);
          insert(imageMarkdown(saved.path, altFromName(file.name || 'image')));
        } catch (e) {
          // Report and stop: continuing after a rejection would bury the message under later
          // uploads, and the usual cause (unsupported type, too large) applies to the rest too.
          setError(e instanceof Error ? e.message : 'Could not add image');
          return true;
        }
      }
      return true;
    } finally {
      setBusy(false);
      setBusyCount(Math.max(0, busyCount - 1));
    }
  }, [insert]);

  /** Reference a remote image by URL — stored as-is, not copied into the bundle. */
  const insertUrl = useCallback((url: string, alt?: string) => {
    const clean = url.trim();
    if (!clean) return;
    insert(imageMarkdown(clean, alt?.trim() || altFromName(clean.split('/').pop() || 'image')));
  }, [insert]);

  return { uploadFiles, insertUrl, busy, error, clearError: () => setError(null) };
}

/** True when a paste/drop carries image files worth intercepting. */
export const hasImageFiles = (dt: DataTransfer | null): boolean =>
  !!dt && Array.from(dt.files || []).some((f) => f.type.startsWith('image/'));

export const imageFilesFrom = (dt: DataTransfer | null): File[] =>
  dt ? Array.from(dt.files || []).filter((f) => f.type.startsWith('image/')) : [];
