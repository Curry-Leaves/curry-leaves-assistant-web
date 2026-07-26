import { useCallback, useEffect, useRef, useState } from 'react';

// Copy-to-clipboard with a self-resetting "copied" flag, so a button can swap its label for
// a confirmation and fall back on its own.
export function useCopy(resetMs = 1400) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => () => { if (timer.current) window.clearTimeout(timer.current); }, []);

  // `html` (optional) is written alongside the plain text as a second clipboard flavour.
  // Rich targets (Docs, Word, Slack, mail) take the HTML and paste formatted; editors and
  // terminals take the text/plain. Without it, pasting a reply into a doc yields literal
  // "**bold**" markdown instead of bold text.
  const copy = useCallback(async (text: string, html?: string) => {
    let ok = false;
    try {
      // Undefined on insecure origins, and it rejects when the document isn't focused —
      // best-effort, with the legacy path below as the safety net.
      if (navigator.clipboard) {
        if (html && typeof ClipboardItem !== 'undefined' && navigator.clipboard.write) {
          // `write()` (unlike writeText) needs the clipboard-write permission, which a
          // plain browser tab often refuses with NotAllowedError. That's expected, not
          // exceptional — the execCommand path below still delivers both flavours.
          await navigator.clipboard.write([new ClipboardItem({
            'text/html': new Blob([html], { type: 'text/html' }),
            'text/plain': new Blob([text], { type: 'text/plain' }),
          })]);
          ok = true;
        } else if (!html) {
          await navigator.clipboard.writeText(text);
          ok = true;
        }
        // With html but no ClipboardItem support we deliberately leave ok=false so the
        // rich execCommand path runs, rather than silently downgrading to plain text.
      }
    } catch {
      /* commonly NotAllowedError (no clipboard-write permission) — the path below handles it */
    }
    if (!ok) {
      // Deprecated, but the only thing that works on an insecure origin — which is how the
      // app is served in plain web mode. Without it copy silently no-ops there while
      // looking fine in the Electron build. Selecting a rendered contenteditable (rather
      // than a textarea) is what carries the rich flavour through this path too.
      try {
        const host = document.createElement(html ? 'div' : 'textarea');
        if (html) {
          host.innerHTML = html;
          host.setAttribute('contenteditable', 'true');
        } else {
          (host as HTMLTextAreaElement).value = text;
          host.setAttribute('readonly', '');
        }
        // Off-screen but NOT opacity:0 / display:none — a hidden node can't be selected,
        // so execCommand('copy') would come back empty (or plain) instead of rich.
        host.style.cssText = 'position:fixed;left:-9999px;top:0;white-space:pre-wrap';
        document.body.appendChild(host);
        if (html) {
          const range = document.createRange();
          range.selectNodeContents(host);
          const sel = window.getSelection();
          sel?.removeAllRanges();
          sel?.addRange(range);
        } else {
          (host as HTMLTextAreaElement).select();
        }
        ok = document.execCommand('copy');
        window.getSelection()?.removeAllRanges();
        document.body.removeChild(host);
      } catch {
        /* genuinely no clipboard access — leave the button in its resting state */
      }
    }
    if (!ok) return;
    setCopied(true);
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setCopied(false), resetMs);
  }, [resetMs]);

  return { copied, copy };
}
