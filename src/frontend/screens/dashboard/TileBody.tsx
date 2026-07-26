import { Markdown, InlineMarkdown } from '../../components/Markdown';
import type { TileShapedOutput, TileDiffLine } from '../../types';

/** Pure render of a tile's cached output, shaped per its declared format. Never
 *  throws on a mismatched shape — falls back to a plain string render. Agent text
 *  is realistically always markdown-flavored (bold, links), so every branch here
 *  renders through Markdown/InlineMarkdown rather than as raw text. */
export function TileBody({ output, emptyMessage }: { output: TileShapedOutput | null; emptyMessage?: string }) {
  if (!output) return <div className="text-[12px] text-ink3">Not run yet.</div>;

  if (output.empty) {
    return (
      <div className="flex-1 flex items-center justify-center text-center text-[12px] text-ink3 px-2">
        {emptyMessage?.trim() || 'Nothing to report.'}
      </div>
    );
  }

  if (output.format === 'metric' && typeof output.value === 'object' && !Array.isArray(output.value) && 'value' in output.value) {
    const m = output.value as { value: string; label: string | null; delta?: string | null };
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-1">
        <div className="font-serif text-[34px] leading-none text-ink">{m.value}</div>
        {m.label && <div className="text-[11.5px] text-ink3 text-center"><InlineMarkdown text={m.label} /></div>}
        {m.delta && <div className="text-[10.5px] text-ink3/80 text-center"><InlineMarkdown text={m.delta} /></div>}
      </div>
    );
  }

  if (output.format === 'list' && Array.isArray(output.value)) {
    const items = output.value as string[];
    return (
      <ul className="text-[12.5px] text-ink2 leading-relaxed list-disc pl-4 space-y-0.5">
        {items.map((item, i) => <li key={i}><InlineMarkdown text={item} /></li>)}
      </ul>
    );
  }

  if (output.format === 'diff' && Array.isArray(output.value)) {
    const lines = output.value as TileDiffLine[];
    return (
      <div className="font-mono text-[11.5px] leading-relaxed rounded-[6px] overflow-hidden border border-border">
        {lines.map((l, i) => (
          <div key={i} className={`flex gap-2 px-2 py-0.5 ${
            l.kind === 'add' ? 'bg-ok/10' : l.kind === 'remove' ? 'bg-rec/10' : ''}`}>
            <span className={`flex-none select-none ${
              l.kind === 'add' ? 'text-ok' : l.kind === 'remove' ? 'text-rec' : 'text-ink3'}`}>
              {l.kind === 'add' ? '+' : l.kind === 'remove' ? '−' : ' '}
            </span>
            <span className={`whitespace-pre-wrap break-words ${
              l.kind === 'add' ? 'text-ink' : l.kind === 'remove' ? 'text-ink2 line-through decoration-rec/50' : 'text-ink3'}`}>
              <InlineMarkdown text={l.text} />
            </span>
          </div>
        ))}
      </div>
    );
  }

  if (output.format === 'table' && typeof output.value === 'object' && !Array.isArray(output.value) && 'header' in output.value) {
    const t = output.value as { header: string[]; rows: string[][] };
    return (
      <div className="overflow-auto">
        <table className="w-full text-[11.5px] border-collapse">
          <thead>
            <tr>{t.header.map((h, i) => <th key={i} className="text-left font-600 text-ink3 border-b border-border py-1 pr-3"><InlineMarkdown text={h} /></th>)}</tr>
          </thead>
          <tbody>
            {t.rows.map((row, i) => (
              <tr key={i}>{row.map((c, j) => <td key={j} className="text-ink2 py-1 pr-3 border-b border-border/60"><InlineMarkdown text={c} /></td>)}</tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  // summary and markdown both render as markdown — agent prose is realistically
  // always markdown-flavored (bold, links, lists), so a plain-text fallback would
  // leave literal `**`/`[]()` syntax on screen for the common case. textSize keeps
  // it at the same 12.5px every other tile body format uses (Markdown's own
  // default of 14px is sized for chat/notes, not the compact tile body).
  const text = typeof output.value === 'string' ? output.value : JSON.stringify(output.value);
  return <Markdown text={text} textSize="text-[12.5px]" />;
}
