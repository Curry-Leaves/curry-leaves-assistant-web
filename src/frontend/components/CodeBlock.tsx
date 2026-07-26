import { useEffect, useMemo, useRef, useState } from 'react';

// A code block with a line-number gutter. Shared by the Markdown renderer (for
// fenced ``` blocks) and by chat/run bubbles (for a bare JSON payload). When the
// language is json we pretty-print + lightly syntax-highlight the value; anything
// unparseable falls back to the raw text so we never hide content.

function tryPrettyJson(raw: string): string | null {
  const t = raw.trim();
  if (!(t.startsWith('{') || t.startsWith('['))) return null;
  try {
    return JSON.stringify(JSON.parse(t), null, 2);
  } catch {
    return null;
  }
}

// Minimal, dependency-free JSON token colouring for one already-formatted line.
// We match strings (keys vs values), numbers, booleans/null, and punctuation.
const JSON_TOKEN = /("(?:\\.|[^"\\])*"\s*:)|("(?:\\.|[^"\\])*")|(\b-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b)|(\btrue\b|\bfalse\b|\bnull\b)/g;

function HighlightedJsonLine({ text }: { text: string }) {
  const parts: React.ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  JSON_TOKEN.lastIndex = 0;
  while ((m = JSON_TOKEN.exec(text)) !== null) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    const [full, key, str, num, kw] = m;
    if (key) parts.push(<span key={m.index} className="text-accent">{full}</span>);
    else if (str) parts.push(<span key={m.index} className="text-emerald-500 dark:text-emerald-400">{full}</span>);
    else if (num) parts.push(<span key={m.index} className="text-sky-600 dark:text-sky-400">{full}</span>);
    else if (kw) parts.push(<span key={m.index} className="text-purple-500 dark:text-purple-400">{full}</span>);
    last = m.index + full.length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return <>{parts}</>;
}

export function CodeBlock({ code, language }: { code: string; language?: string }) {
  const [copied, setCopied] = useState(false);
  const isJson = language === 'json' || language === 'json5';
  const pretty = useMemo(() => (isJson ? tryPrettyJson(code) : null), [code, isJson]);
  const body = pretty ?? code.replace(/\n$/, '');
  const lines = body.split('\n');
  const gutterWidth = String(lines.length).length;

  const copyTimer = useRef<number | undefined>(undefined);
  useEffect(() => () => { if (copyTimer.current) window.clearTimeout(copyTimer.current); }, []);

  const copy = () => {
    try {
      navigator.clipboard?.writeText(body);
      setCopied(true);
      if (copyTimer.current) window.clearTimeout(copyTimer.current);
      copyTimer.current = window.setTimeout(() => setCopied(false), 1200);
    } catch {
      /* clipboard unavailable — no-op */
    }
  };

  return (
    <div className="group relative my-2 rounded-[10px] border border-border bg-bg overflow-hidden">
      <div className="flex items-center justify-between px-3 py-1 border-b border-border/70 bg-border-soft/40">
          <span className="text-[10.5px] font-mono uppercase tracking-wide text-ink3">{language || 'text'}</span>
          <button
            type="button"
            onClick={copy}
            title="Copy code"
            aria-label={copied ? 'Copied' : 'Copy code'}
            className="inline-flex items-center gap-1 text-[10.5px] text-ink3 hover:text-ink px-1.5 py-0.5 rounded border border-transparent hover:border-border/70 transition-colors"
          >
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              {copied
                ? <path d="M20 6 9 17l-5-5" />
                : (<><rect x="9" y="9" width="13" height="13" rx="2" ry="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></>)}
            </svg>
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
      <div className="overflow-x-auto">
        <table className="border-collapse font-mono text-[12px] leading-[1.55]">
          <tbody>
            {lines.map((line, i) => (
              <tr key={i} className="align-top">
                <td
                  className="select-none text-right pr-3 pl-3 text-ink3/60 tabular-nums border-r border-border/50 sticky left-0 bg-bg"
                  style={{ minWidth: `${gutterWidth + 2}ch` }}
                >
                  {i + 1}
                </td>
                <td className="pl-3 pr-4 whitespace-pre text-ink">
                  {pretty ? <HighlightedJsonLine text={line} /> : line || ' '}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// True when the entire string is a single JSON object/array — used by bubbles to
// decide whether to render bare content through CodeBlock instead of as prose.
export function isJsonPayload(raw: string): boolean {
  const t = raw.trim();
  if (!(t.startsWith('{') && t.endsWith('}')) && !(t.startsWith('[') && t.endsWith(']'))) return false;
  try {
    JSON.parse(t);
    return true;
  } catch {
    return false;
  }
}
