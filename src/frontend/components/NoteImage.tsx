/** An `<img>` in a note, with bundle-relative sources resolved to the backend.
 *
 * Notes store attachments as ordinary relative markdown links (`![alt](assets/shot.png)`) so the
 * vault stays portable — the same link resolves in Obsidian or any markdown viewer pointed at the
 * folder. In THIS app the note is rendered by a web page whose origin is usually not the backend
 * (dev server on :5173, desktop shell on file://), so a relative src would resolve against the
 * page and 404. Rewrite those to the asset route; absolute and data: URLs are left alone.
 *
 * The URL is resolved asynchronously because the backend base is only known at runtime (the
 * desktop shell hands it to the frontend on boot), so we render nothing until it lands rather
 * than briefly emitting a broken <img> that flashes an error icon.
 */
import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { splitDimensions } from './noteImages';

const isAbsolute = (s: string) => /^(https?:|data:|blob:|file:)/i.test(s);

export function NoteImage({ src, alt, ...rest }: { src?: string; alt?: string } & Record<string, any>) {
  const { path, width, height, align } = splitDimensions(src ?? '');
  const [resolved, setResolved] = useState<string | undefined>(
    src && isAbsolute(src) ? path : undefined,
  );
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!path) { setResolved(undefined); return; }
    if (isAbsolute(path)) { setResolved(path); return; }
    let live = true;
    // Strip a leading "./" or "/" so both `assets/x.png` and `/assets/x.png` work — agents and
    // hand-written notes produce both spellings.
    api.knowledgeAssetUrl(path.replace(/^\.?\//, '')).then((u) => { if (live) setResolved(u); });
    return () => { live = false; };
  }, [path]);

  // A missing attachment should read as a missing attachment, not a browser broken-image glyph
  // with no hint of which file is gone.
  if (failed) {
    return (
      <span className="inline-flex items-center gap-1.5 my-2 px-2 py-1 rounded-[8px] border border-border bg-border-soft/40 text-[12px] text-ink3">
        Missing image{alt ? `: ${alt}` : ''}
        <code className="font-mono text-[11px] text-faint">{src}</code>
      </span>
    );
  }
  if (!resolved) return null;
  return (
    <img
      className="max-w-full rounded-[10px] border border-border my-2"
      loading="lazy"
      src={resolved}
      alt={alt ?? ''}
      // Width/height as style, not attributes: `max-w-full` must still win on a narrow pane,
      // so a large explicit width shrinks rather than overflowing the column. Alignment uses
      // auto margins on a block image — `text-align` on the parent wouldn't work here, since
      // react-markdown gives us the <img> but not its wrapping paragraph.
      style={{
        width: width ? `${width}px` : undefined,
        height: height ? `${height}px` : undefined,
        ...(align === 'center' ? { display: 'block', marginLeft: 'auto', marginRight: 'auto' } : {}),
        ...(align === 'right' ? { display: 'block', marginLeft: 'auto', marginRight: 0 } : {}),
      }}
      onError={() => setFailed(true)}
      {...rest}
    />
  );
}
