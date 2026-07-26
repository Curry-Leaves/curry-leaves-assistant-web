import { useRef } from 'react';
import { Icon } from '../../components/chrome/Icon';
import { CodeBlock, isJsonPayload } from '../../components/CodeBlock';
import { useVerboseChat } from '../../prefs';
import { useCopy } from '../../components/useCopy';
import { ActivityLine } from './ActivityLine';
import { ArtifactEmbed, extractArtifactLinks } from './ArtifactEmbed';
import { Markdown } from './Markdown';
import { SubagentSteps } from './SubagentTree';
import { ThinkingBlock } from './ThinkingBlock';
import { ORPHAN, ToolCallCard, ToolGroup, subsByParent } from './ToolCallCard';
import type { ChatMsg } from './model';

/** Turn duration, at whatever precision reads best: `840ms`, `3.2s`, `1m 24s`.
 *  Sub-second stays in ms (a "0.8s" reply looks slower than it felt); past a minute,
 *  raw seconds stop being legible. */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const s = ms / 1000;
  if (s < 10) return `${s.toFixed(1)}s`;
  // Round to whole seconds FIRST, then split — otherwise 59.6s renders "0m 60s": the
  // remainder rounds up to 60 without ever carrying into the minutes column.
  const total = Math.round(s);
  if (total < 60) return `${total}s`;
  const mins = Math.floor(total / 60);
  const rem = total % 60;
  // 90s → "1m 30s"; 120s → "2m" (a bare "0s" tail is noise)
  return rem ? `${mins}m ${rem}s` : `${mins}m`;
}

// Copy-the-reply action under an assistant message. Copies the raw markdown (what the
// model actually wrote) rather than the rendered text, so pasting into a doc or issue
// keeps the headings, lists and code fences intact.
// Snapshot the rendered reply as self-contained HTML. The app styles bold/emphasis with
// utility CLASSES (`font-650`), and a paste target gets none of our stylesheet — so bold
// would silently arrive as normal text. Inlining the computed weight/style on a detached
// clone is what survives the trip into Docs/Word/Slack.
function richHtml(node: HTMLDivElement | null): string | undefined {
  if (!node) return undefined;
  const clone = node.cloneNode(true) as HTMLElement;
  const src = node.querySelectorAll<HTMLElement>('*');
  const dst = clone.querySelectorAll<HTMLElement>('*');
  src.forEach((el, i) => {
    const cs = getComputedStyle(el);
    const t = dst[i];
    if (!t) return;
    if (parseInt(cs.fontWeight, 10) >= 600) t.style.fontWeight = 'bold';
    if (cs.fontStyle === 'italic') t.style.fontStyle = 'italic';
    if (cs.textDecorationLine.includes('line-through')) t.style.textDecoration = 'line-through';
    if (cs.fontFamily.toLowerCase().includes('mono')) t.style.fontFamily = 'monospace';
  });
  return clone.innerHTML;
}

// `bodyRef` points at the rendered reply. We copy BOTH flavours: that HTML so rich targets
// (Docs, Word, Slack, mail) paste formatted, and the markdown source as text/plain for
// editors and terminals. Copying only the source pasted literal "**bold**" everywhere.
function CopyReply({ text, bodyRef }: { text: string; bodyRef: React.RefObject<HTMLDivElement | null> }) {
  const { copied, copy } = useCopy();
  return (
    <button
      type="button"
      onClick={() => copy(text, richHtml(bodyRef.current))}
      title="Copy reply as markdown"
      aria-label={copied ? 'Copied to clipboard' : 'Copy reply as markdown'}
      className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-[6px] transition-colors
        focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent/50
        ${copied ? 'text-ok' : 'text-ink3 hover:text-ink hover:bg-border-soft/60'}`}
    >
      <Icon name={copied ? 'check' : 'copy'} size={10} />
      {copied ? 'Copied' : 'Copy'}
    </button>
  );
}

// ─── message bubble ───────────────────────────────────────────────────────────
const DOT_DELAY = ['', '[animation-delay:0.2s]', '[animation-delay:0.4s]'];
const Dot = ({ d = 0 }: { d?: number }) => <span className={`an-pulse w-1.5 h-1.5 rounded-full bg-ink3 ${DOT_DELAY[d]}`} />;

// `live`: this bubble's run is still going (tools may yet arrive) — defaults to `streaming`.
// Kept separate because `streaming` is also forced off while an approve/ask prompt is up,
// and the tool list shouldn't fold away mid-run just because the user is being asked.
export function Bubble({ m, streaming, live = streaming, onFork, onOpenNote }: { m: ChatMsg; streaming: boolean; live?: boolean; onFork?: () => void; onOpenNote?: (path: string) => void }) {
  // Verbose (off by default): show tool cards + the subagent tree; only used on the
  // assistant path below. Read up here — before any early return — so the hook call is
  // unconditional (Rules of Hooks); the action/elision/user branches simply ignore it.
  const [verbose] = useVerboseChat();
  // The rendered reply node, read by the copy action to put formatted HTML on the clipboard
  // alongside the markdown source. Declared up here so the hook call stays unconditional.
  const bodyRef = useRef<HTMLDivElement>(null);
  if (m.action) {
    return (
      <div className="flex justify-center my-0.5">
        <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-ok/10 border border-ok/30 text-[12px] text-ink2 max-w-full">
          <span className="text-ok flex-none"><Icon name={m.action.kind === 'todo' ? 'check' : 'bell'} size={12} /></span>
          <span className="flex-none">{m.action.kind === 'todo' ? 'Todo added' : 'Reminder set'}:</span>
          <span className="font-550 text-ink truncate">{m.action.title}</span>
          {m.action.meta && <span className="text-ink3 flex-none">· {m.action.meta}</span>}
        </div>
      </div>
    );
  }
  if (m.elision) {
    const kTokens = Math.round(m.elision.tokensReclaimed / 1000);
    return (
      <div className="flex justify-center my-0.5">
        <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-border-soft border border-border text-[11.5px] text-ink3 max-w-full">
          <Icon name="wave" size={12} />
          <span>
            Reclaimed {kTokens > 0 ? `~${kTokens}K tokens` : 'context'} — stubbed {m.elision.resultsElided} stale tool result{m.elision.resultsElided === 1 ? '' : 's'}
          </span>
        </div>
      </div>
    );
  }
  if (m.compacted) {
    return (
      <div className="my-1">
        <div className="flex items-center gap-2 text-[10px] uppercase tracking-wider text-ink3 mb-1.5">
          <span className="flex-1 h-px bg-border" /><Icon name="wave" size={11} /> Conversation compacted <span className="flex-1 h-px bg-border" />
        </div>
        <div className="px-3.5 py-2.5 rounded-[12px] bg-sidebar/60 border border-sidebar-border text-sidebar-ink text-[13px] whitespace-pre-wrap break-words leading-relaxed">{m.content}</div>
      </div>
    );
  }
  if (m.role === 'user') {
    return (
      <div className="group flex justify-end items-end gap-1.5">
        {onFork && (
          <button type="button" title="Fork from here — branch a new chat starting at this message" onClick={onFork}
            className="mb-1 w-6 h-6 flex-none flex items-center justify-center rounded-[7px] text-ink3 opacity-0 group-hover:opacity-100 hover:text-accent hover:bg-accent-soft/40 transition-opacity">
            <Icon name="fork" size={13} />
          </button>
        )}
        <div className="max-w-[80%] min-w-0 flex flex-col items-end gap-1.5">
          {m.attachments && m.attachments.length > 0 && (
            <div className="flex flex-wrap gap-1.5 justify-end">
              {m.attachments.map((a, i) => (
                <span key={i} className="inline-flex items-center gap-1.5 px-2 py-1 rounded-[8px] bg-accent-soft/60 border border-accent/30 text-[11.5px] text-accent-ink max-w-[220px]">
                  <Icon name="file" size={11} />
                  <span className="truncate">{a.name}</span>
                </span>
              ))}
            </div>
          )}
          {m.content && (
            <div className="px-3.5 py-2.5 rounded-[14px] rounded-br-[4px] bg-accent text-white text-[13px] whitespace-pre-wrap break-words leading-relaxed">{m.content}</div>
          )}
        </div>
      </div>
    );
  }
  // Subagent steps bucketed by the tool call that delegated them, so each card renders
  // its own. ToolGroup takes the raw list and buckets internally (it also renders the
  // orphans), so only the live / single-card branches surface leftovers here.
  const subs = subsByParent(m.subs);
  const grouped = !live && !!m.tools && m.tools.length > 0 && !(m.tools.length === 1 && !m.thinking);
  const showOrphans = !grouped && !!subs.get(ORPHAN)?.length;
  const hasUsage = !!m.usage && (m.usage.input > 0 || m.usage.output > 0);
  return (
    <div className="flex justify-start">
      <div className="w-full min-w-0 flex flex-col gap-1.5">
        {/* Non-verbose (default): show ONLY the assistant's thinking — streamed live while
            the turn runs, kept as a block once done — and its reply below. No tool cards,
            no subagent tree. Verbose surfaces the full activity.
            Verbose — Live: thinking + each tool call stream in as their own blocks. Finished:
            the whole turn's work (thought + tool calls) folds under one ToolGroup collapse;
            a lone tool call with no thinking stays a flat card. Either way a delegated
            subagent's steps render INSIDE the tool call that spawned them, so delegation
            reads as nesting. */}
        {!verbose ? (
          <>
            {m.thinking && <ThinkingBlock text={m.thinking} live={live && streaming && !m.content} />}
            {/* Still-working signal: with no tool cards on screen, a turn sitting inside a
                long tool call (or one that never emits thinking) looks frozen. Drops away
                as soon as the reply starts arriving. */}
            {live && streaming && !m.content && <ActivityLine m={m} />}
          </>
        ) : live ? (
          <>
            {m.thinking && <ThinkingBlock text={m.thinking} live={streaming && !m.content} />}
            {m.tools?.map((t) => <ToolCallCard key={t.id} t={t} subs={subs.get(t.id)} />)}
          </>
        ) : m.tools && m.tools.length > 0 ? (
          m.tools.length === 1 && !m.thinking
            ? <ToolCallCard t={m.tools[0]} subs={subs.get(m.tools[0].id)} />
            : <ToolGroup tools={m.tools} thinking={m.thinking} trail={m.trail} subs={m.subs} />
        ) : (
          m.thinking && <ThinkingBlock text={m.thinking} live={false} />
        )}
        {/* Steps we couldn't hang under a call (older kernel / hidden task tool) — kept
            visible rather than dropped. The grouped branch renders its own inside. */}
        {verbose && showOrphans && <SubagentSteps subs={subs.get(ORPHAN)!} />}
        {(m.content || streaming) && (
          // A finished reply whose whole body is a JSON object/array (e.g. a structured
          // tile/run's output) renders in a line-numbered, pretty-printed code viewer
          // rather than as a wall of prose. While streaming we keep raw text — a partial
          // object won't parse yet.
          m.content && !streaming && isJsonPayload(m.content)
            ? <CodeBlock code={m.content} language="json" />
            : (
              <div ref={bodyRef} className="px-3.5 py-2.5 rounded-[14px] rounded-bl-[4px] bg-card border border-border text-ink">
                {m.content
                  ? <Markdown text={m.content} textSize="text-[13px]" onNavigate={onOpenNote} streaming={streaming} />
                  : <span className="inline-flex gap-1 items-center text-ink3"><Dot /><Dot d={1} /><Dot d={2} /></span>}
              </div>
            )
        )}
        {/* Any artifact share link in the reply also renders as an inline preview
            (skipped while streaming so a half-arrived URL doesn't flash a 404 frame). */}
        {m.content && !streaming &&
          extractArtifactLinks(m.content).map((a) => <ArtifactEmbed key={a.id} id={a.id} url={a.url} />)}
        {/* Footer line: usage metrics, with Copy as the last item. Rendered whenever the
            reply is finished — a turn with no usage numbers still gets the copy action, so
            the row is gated on either half having something to show. */}
        {(hasUsage || (m.content && !streaming)) && (
          <div className="mt-1 flex items-center gap-2 font-mono text-[10px] text-ink3">
            {hasUsage && (
              <span>
                {m.usage!.model && <span className="mr-2 text-ink2">{m.usage!.model}</span>}
                {m.usage!.input.toLocaleString()} in · {m.usage!.output.toLocaleString()} out · {(m.usage!.input + m.usage!.output).toLocaleString()} tokens
                {/* input/output are cumulative across the turn's LLM calls (billed cost). On a
                    multi-call turn (tool use) that's much larger than the context the model
                    actually held — show that separately so it doesn't read as window fullness. */}
                {!!m.usage!.context && m.usage!.context < m.usage!.input && (
                  <span className="ml-2 text-ink2">· {m.usage!.context.toLocaleString()} ctx</span>
                )}
                {/* Wall time for the whole turn, tools and subagents included. */}
                {!!m.usage!.elapsedMs && <span className="ml-2 text-ink2">· {formatDuration(m.usage!.elapsedMs)}</span>}
              </span>
            )}
            {m.content && !streaming && <CopyReply text={m.content} bodyRef={bodyRef} />}
          </div>
        )}
      </div>
    </div>
  );
}
