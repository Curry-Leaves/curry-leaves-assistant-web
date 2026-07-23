import { useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from '../components/chrome/Icon';
import { TabPlaceholder } from '../components/chrome/TabPlaceholder';
import { Markdown } from '../components/Markdown';
import { api, subscribeEvents } from '../api/client';
import { AudioPlayer } from '../components/audio/AudioPlayer';
import { TrimPanel } from '../components/audio/TrimPanel';
import { RecordingContextPanel } from '../components/RecordingContextPanel';
import { TemplateMultiPicker } from '../components/TemplateMultiPicker';
import type { MeetingTemplate, Recording, RecordingOutput, Todo } from '../types';

// ─── helpers ────────────────────────────────────────────────────────────────
// Agents bound to a recording that never produce a viewable artifact — they act on
// metadata/knowledge instead, so they should not get a recording output tab.
const NON_OUTPUT_AGENTS = new Set(['title-generator', 'kb-filer']);

const fmtDur = (s: number | null) => (s == null ? '' : `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`);
const fmtDate = (iso: string) =>
  new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

function status(r: Recording): { label: string; tone: string; dot: string; pulse?: boolean } {
  if (r.status === 'recording') return { label: 'recording', tone: 'text-rec', dot: 'bg-rec', pulse: true };
  if (r.status === 'interrupted') return { label: 'interrupted', tone: 'text-amber-600', dot: 'bg-amber-500' };
  if ((r.outputs?.length ?? 0) > 0 || r.summary) return { label: 'processed', tone: 'text-ok', dot: 'bg-ok' };
  if (r.transcript) return { label: 'transcribed', tone: 'text-accent-dark', dot: 'bg-accent' };
  return { label: 'processing', tone: 'text-ink3', dot: 'bg-accent', pulse: true };
}

const isDone = (r: Recording) => (r.outputs?.length ?? 0) > 0 || !!r.summary;

type Filter = 'all' | 'active' | 'done';

// A banner for a recording orphaned mid-capture (app closed / crashed while recording). It
// explains what happened and offers Save (finalize + transcribe) or Discard. Shown above the
// list, not as a normal row — there's no detail pane to open until the user decides.
function InterruptedBanner({ rec, onChanged }: { rec: Recording; onChanged: () => void }) {
  const [busy, setBusy] = useState<'save' | 'discard' | null>(null);
  const save = async () => {
    if (busy) return;
    setBusy('save');
    try { await api.recoverRecording(rec.id); onChanged(); }
    catch { setBusy(null); }
  };
  const discard = async () => {
    if (busy) return;
    setBusy('discard');
    try { await api.deleteRecording(rec.id); onChanged(); }
    catch { setBusy(null); }
  };
  return (
    <div className="px-3 py-2.5 rounded-[8px] border border-amber-500/40 bg-amber-500/[0.07]">
      <div className="flex items-center gap-1.5 mb-1">
        <Icon name="warning" size={13} color="#d97706" />
        <span className="text-[11.5px] font-600 text-amber-700">Recording didn’t finish saving</span>
      </div>
      <p className="text-[11px] text-amber-700/90 leading-snug mb-2">
        “{rec.name}” was interrupted mid-capture{rec.duration ? ` after ${fmtDur(rec.duration)}` : ''}.
        Save it to transcribe and summarize as usual, or discard it.
      </p>
      <div className="flex items-center gap-1.5">
        <button
          type="button" onClick={save} disabled={!!busy}
          className="flex-1 h-7 rounded-[5px] bg-accent text-on-accent text-[11.5px] font-550 disabled:opacity-60 inline-flex items-center justify-center gap-1"
        >
          <Icon name="check" size={12} color="var(--color-on-accent)" />
          {busy === 'save' ? 'Saving…' : 'Save & transcribe'}
        </button>
        <button
          type="button" onClick={discard} disabled={!!busy}
          className="h-7 px-2.5 rounded-[5px] border border-border text-ink3 text-[11.5px] hover:bg-hover disabled:opacity-60 inline-flex items-center gap-1"
        >
          <Icon name="trash" size={12} color="currentColor" />
          {busy === 'discard' ? 'Discarding…' : 'Discard'}
        </button>
      </div>
    </div>
  );
}

// ─── list row ───────────────────────────────────────────────────────────────
function Row({ rec, active, onClick }: { rec: Recording; active: boolean; onClick: () => void }) {
  const st = status(rec);
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full text-left px-3 py-2 rounded-[6px] border transition-colors ${
        active
          ? 'bg-card border-border shadow-soft'
          : 'border-transparent border-b-border-soft hover:bg-card/50'
      }`}
    >
      <div className="flex items-baseline gap-2 mb-1">
        {st.dot && <span className={`w-1.5 h-1.5 rounded-full flex-none translate-y-[3px] ${st.dot} ${st.pulse ? 'an-pulse' : ''}`} />}
        <span className={`flex-1 truncate text-[12px] ${active ? 'text-ink font-500' : 'text-ink2'}`}>{rec.name}</span>
        <span className="text-[10.5px] text-faint flex-none font-mono">{fmtDur(rec.duration)}</span>
      </div>
      <div className="text-[10.5px] text-faint">{fmtDate(rec.createdAt)}</div>
      {rec.tags?.length > 0 && (
        <div className="flex gap-1 flex-wrap mt-1.5">
          {rec.tags.map((tg) => (
            <span key={tg} className="text-[10px] text-sidebar-ink3 bg-sidebar border border-sidebar-border rounded px-1.5 py-0.5">#{tg}</span>
          ))}
        </div>
      )}
    </button>
  );
}

// ─── detail tabs ────────────────────────────────────────────────────────────
// Fixed tabs plus one dynamic tab per agent output (id-prefixed so it can't collide
// with a fixed tab id).
// The meeting's output document ('doc' — one tab holding all template sections) plus fixed tabs.
type Tab = 'doc' | 'transcript' | 'tasks' | 'context';

type DocSection = { title: string; key: string };
type DocGroup = { templateName: string; sections: DocSection[] };

/** The meeting's output document: ONE tab holding every template's sections, grouped by
 *  template and stacked in order. The user can add/remove templates here (regenerating the
 *  document). Re-run and the "something missing? tell the template" fix act on the whole
 *  document, so the controls sit once at the top. */
function MeetingDoc({ rec, groups, outputByKey, templates, selectedIds, onTemplatesChange, onTemplatesReload }: {
  rec: Recording;
  groups: DocGroup[];
  outputByKey: Map<string, RecordingOutput>;
  templates: MeetingTemplate[];
  selectedIds: string[];
  onTemplatesChange: (ids: string[]) => void;
  onTemplatesReload: () => void;
}) {
  const [busy, setBusy] = useState<null | 'rerun' | 'fix'>(null);
  const [err, setErr] = useState<string | null>(null);
  const allSections = groups.flatMap((g) => g.sections);
  // Track completion by the latest section updatedAt advancing past what we captured on submit.
  const latestUpdated = allSections.map((s) => outputByKey.get(s.key)?.updatedAt || '').sort().at(-1) || '';
  const baselineRef = useRef<string>('');

  useEffect(() => {
    if (!busy) return;
    if (latestUpdated && latestUpdated !== baselineRef.current) { setBusy(null); return; }
    const safety = setTimeout(() => {
      setBusy(null);
      setErr("The rerun didn't produce new output in time — check the AI provider in Settings, then try again.");
    }, 120_000);
    return () => clearTimeout(safety);
  }, [latestUpdated, busy]);

  const rerun = async () => {
    baselineRef.current = latestUpdated;
    setErr(null); setBusy('rerun');
    try { await api.rerunRecordingAgent(rec.id, 'meeting-copilot'); }
    catch (e) { setBusy(null); setErr(`Couldn't start the rerun: ${(e as Error).message}`); }
  };

  const canFix = !!rec.templateId;
  const [fix, setFix] = useState('');
  const submitFix = async () => {
    const instr = fix.trim();
    if (!instr || busy || !rec.templateId) return;
    baselineRef.current = latestUpdated;
    setErr(null); setBusy('fix');
    // reviseTemplate revises the template (an LLM call) AND enqueues the copilot rerun; surface
    // a 502 (provider returned nothing) instead of spinning forever.
    try { await api.reviseTemplate(rec.templateId, instr, rec.id); setFix(''); }
    catch (e) { setBusy(null); setErr(`Couldn't update the template: ${(e as Error).message}`); }
  };

  const anyContent = allSections.some((s) => outputByKey.get(s.key)?.content);

  return (
    <div className="flex flex-col gap-5">
      {/* templates producing this document — add or remove to change what gets generated */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[11px] uppercase tracking-wider text-ink3 font-600">Templates</span>
        <TemplateMultiPicker
          templates={templates} value={selectedIds}
          onChange={onTemplatesChange} onTemplatesChanged={onTemplatesReload}
          compact
        />
        {latestUpdated && <span className="ml-auto text-[11px] text-ink3">Updated {new Date(latestUpdated).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>}
        <button type="button" onClick={rerun} disabled={!!busy}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-[8px] bg-accent text-on-accent text-[12px] hover:bg-accent-dark disabled:opacity-60">
          <Icon name="zap" size={13} color="var(--color-on-accent)" /> {busy === 'rerun' ? 'Regenerating…' : 'Re-run'}
        </button>
      </div>
      {canFix && anyContent && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-[10px] border border-border-soft bg-hover/40">
          <Icon name="sparkle" size={13} color="var(--color-ink3)" />
          <input
            value={fix}
            onChange={(e) => setFix(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') submitFix(); }}
            disabled={busy === 'fix'}
            placeholder="Something missing? Tell the template — e.g. “capture the budget discussion”"
            className="flex-1 bg-transparent text-[12px] text-ink outline-none placeholder:text-ink3 disabled:opacity-60"
          />
          <button type="button" onClick={submitFix} disabled={!!busy || !fix.trim()}
            className="text-[12px] text-accent disabled:opacity-40 hover:underline whitespace-nowrap">
            {busy === 'fix' ? 'Regenerating…' : 'Fix & re-run'}
          </button>
        </div>
      )}
      {busy && (
        <div className="flex items-center gap-2 text-[12px] text-ink3 an-pulse">
          <Icon name="refresh" size={12} color="var(--color-ink3)" />
          {busy === 'fix' ? 'Updating the template and regenerating this recording…' : 'Regenerating…'}
        </div>
      )}
      {err && !busy && (
        <div className="flex items-start gap-2 px-3 py-2 rounded-[10px] border border-rec/40 bg-rec/10 text-[12px] text-rec">
          <Icon name="warning" size={13} color="var(--color-rec)" />
          <span className="flex-1">{err}</span>
        </div>
      )}

      {/* sections, grouped by template (the template name shows only when there's more than one) */}
      {groups.map((g, gi) => (
        <div key={g.templateName || gi} className="flex flex-col gap-4">
          {groups.length > 1 && g.templateName && (
            <div className="text-[12px] font-600 text-ink border-b border-border-soft pb-1">{g.templateName}</div>
          )}
          {g.sections.map((s) => {
            const out = outputByKey.get(s.key);
            return (
              <section key={s.key} className="flex flex-col gap-1.5">
                <h3 className="text-[11px] uppercase tracking-wider text-ink3 font-600">{s.title}</h3>
                {out?.content
                  ? <Markdown text={out.content} textSize="text-[13px]" />
                  : <div className="text-[13px] text-ink3 italic an-pulse">{rec.transcript ? 'Working…' : 'Waiting on the transcript…'}</div>}
              </section>
            );
          })}
        </div>
      ))}
    </div>
  );
}

function Detail({ rec, todos, refresh, onDeleted }: { rec: Recording; todos: Todo[]; refresh: () => void; onDeleted: () => void }) {
  const [outputs, setOutputs] = useState<RecordingOutput[]>([]);
  const loadOutputs = () => api.listRecordingOutputs(rec.id).then(setOutputs).catch(() => {});
  useEffect(() => { loadOutputs(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [rec.id, rec.outputs?.join(',')]);

  // The recording's templates define exactly which sections (and thus the doc) it produces.
  // Fetch the full selection (in order) plus the library so the user can add more here.
  const recTemplateIds = useMemo(
    () => rec.templateIds ?? (rec.templateId ? [rec.templateId] : []),
    [rec.templateIds?.join(','), rec.templateId]);
  const [recTemplates, setRecTemplates] = useState<MeetingTemplate[]>([]);
  const [allTemplates, setAllTemplates] = useState<MeetingTemplate[]>([]);
  const loadTemplates = () => api.listTemplates().then((r) => setAllTemplates(r.templates)).catch(() => {});
  useEffect(() => { loadTemplates(); }, []);
  useEffect(() => {
    Promise.all(recTemplateIds.map((id) => api.getTemplate(id).catch(() => null)))
      .then((ts) => setRecTemplates(ts.filter(Boolean) as MeetingTemplate[]));
  }, [recTemplateIds]);

  const setTemplates = (ids: string[]) => api.updateRecording(rec.id, { templateIds: ids }).then(() => refresh()).catch(() => {});
  // Refresh outputs live as agents finish, instead of polling.
  useEffect(() => {
    let unsub: (() => void) | undefined;
    subscribeEvents((e: any) => {
      if (!e?.type) return;
      const matchesRec = e.payload?.id === rec.id || e.entityId === rec.id;
      if ((e.type === 'recording.output.saved' || e.type.startsWith('agent.run.')) && matchesRec) loadOutputs();
    }).then((fn) => { unsub = fn; });
    return () => unsub?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rec.id]);

  const outputByKey = useMemo(() => new Map(outputs.map((o) => [o.key, o])), [outputs]);

  // ONE output tab named after the template (e.g. "Brainstorm"), whose body stacks all the
  // template's sections in order. The meeting produces a single document with sections, not a
  // tab per section. Each section maps to its output file key (`summary` → `meeting-summarizer`;
  // others → `meeting-copilot.<section>`); a section with no file yet renders as pending.
  // Build the document's section groups from ALL the recording's templates, in order. Section
  // → output-file-key mapping mirrors the backend: the PRIMARY (first) template keeps bare
  // section ids (`summary` → the summary file); additional templates namespace their sections
  // as `<templateId>__<section>` to avoid collisions. Each group renders under its template name.
  const docGroups = useMemo(() => {
    const outKey = (secId: string) => (secId === 'summary' ? 'meeting-summarizer' : `meeting-copilot.${secId}`);
    if (recTemplates.length) {
      return recTemplates.map((tpl, ti) => ({
        templateName: tpl.name,
        sections: tpl.sections.map((s) => {
          const secId = ti === 0 ? s.id : `${tpl.id}__${s.id}`;
          return { title: s.title, key: outKey(secId) };
        }),
      }));
    }
    // Legacy / no template: one group of whatever output files exist.
    const legacy = outputs.filter((o) => !NON_OUTPUT_AGENTS.has(o.agentId)).map((o) => ({ title: o.title, key: o.key }));
    return legacy.length ? [{ templateName: '', sections: legacy }] : [];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recTemplates.map((t) => t.id).join(','), recTemplates.map((t) => t.sections.map((s) => s.id).join('|')).join(','), outputs.map((o) => o.key).join(',')]);

  const hasDoc = docGroups.length > 0;
  // Tab label: single template → its name; multiple → "Meeting" (the combined document).
  const docTitle = recTemplates.length === 1 ? recTemplates[0].name : recTemplates.length > 1 ? 'Meeting' : 'Summary';

  const [tab, setTab] = useState<Tab>('transcript');
  const [trimming, setTrimming] = useState(false);
  const st = status(rec);
  const linked = todos.filter((t) => t.source?.id === rec.id);
  useEffect(() => {
    setTab(hasDoc ? 'doc' : 'transcript');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rec.id, hasDoc]);
  useEffect(() => { setTrimming(false); }, [rec.id]);

  const ctxCount = (rec.attachments?.length ?? 0) + (rec.links?.length ?? 0) + ((rec.notes ?? '').trim() ? 1 : 0);
  const TABS: { id: Tab; label: string; n?: number }[] = [
    ...(hasDoc ? [{ id: 'doc' as Tab, label: docTitle }] : []),
    { id: 'transcript', label: 'Transcript' },
    { id: 'tasks', label: 'Tasks', n: linked.length },
    { id: 'context', label: 'Notes & files', n: ctxCount },
  ];

  const [resubmitting, setResubmitting] = useState(false);
  const resubmit = async () => {
    setResubmitting(true);
    try { await api.resubmitRecording(rec.id); } catch { /* noop */ }
    setTimeout(() => { setResubmitting(false); loadOutputs(); }, 1800);
  };

  const [deleteStep, setDeleteStep] = useState(0);
  useEffect(() => { setDeleteStep(0); }, [rec.id]);
  const handleDelete = async () => {
    if (deleteStep === 0) { setDeleteStep(1); setTimeout(() => setDeleteStep((s) => (s === 1 ? 0 : s)), 3000); return; }
    setDeleteStep(2);
    try { await api.deleteRecording(rec.id); onDeleted(); }
    catch { setDeleteStep(0); }
  };

  return (
    <div className="flex-1 flex flex-col min-w-0">
      {/* header */}
      <div className="px-7 pt-6 pb-3 border-b border-border">
        <div className="flex items-start gap-3">
          <h2 className="font-serif italic text-[22px] text-ink mb-1 flex-1 min-w-0 truncate">{rec.name}</h2>
          {rec.transcript && (
            <button type="button" onClick={resubmit} disabled={resubmitting} title="Re-emit recording.transcribed → re-run all bound agents"
              className="flex-none flex items-center gap-1.5 px-2.5 py-1.5 rounded-[8px] bg-accent text-on-accent text-[12px] hover:bg-accent-dark disabled:opacity-60">
              <Icon name="zap" size={13} color="var(--color-on-accent)" /> {resubmitting ? 'Queued…' : 'Re-run all'}
            </button>
          )}
          <button type="button" onClick={handleDelete} disabled={deleteStep === 2}
            title={deleteStep === 1 ? 'Click again to confirm' : 'Delete recording'}
            className={`flex-none flex items-center gap-1.5 px-2.5 py-1.5 rounded-[8px] border text-[12px] ${
              deleteStep === 1 ? 'border-rec/50 text-rec bg-rec/10' : 'border-border text-ink2 hover:border-ink3'}`}>
            <Icon name="trash" size={13} color={deleteStep === 1 ? 'var(--color-rec)' : undefined} />
            {deleteStep === 1 ? 'Confirm delete' : 'Delete'}
          </button>
        </div>
        <div className="flex items-center gap-3 text-[12px] text-ink3">
          <span className={`flex items-center gap-1.5 font-mono ${st.tone}`}>
            <span className={`w-1.5 h-1.5 rounded-full ${st.dot} ${st.pulse ? 'an-pulse' : ''}`} />
            {st.label}
          </span>
          {rec.duration != null && <span>{fmtDur(rec.duration)}</span>}
          <span>{fmtDate(rec.createdAt)}</span>
        </div>
        <AudioPlayer rec={rec} onEditAudio={() => setTrimming(true)} onChanged={refresh} />
        {!trimming && <div className="flex gap-1 mt-2 bg-sidebar border border-sidebar-border rounded-[7px] p-0.5 w-fit">
          {TABS.map((tb) => (
            <button
              key={tb.id}
              type="button"
              onClick={() => setTab(tb.id)}
              className={`px-3 py-1 rounded-[5px] text-[12px] ${tab === tb.id ? 'bg-card text-ink shadow-soft' : 'text-sidebar-ink3'}`}
            >
              {tb.label}{tb.n ? ` ${tb.n}` : ''}
            </button>
          ))}
        </div>}
      </div>

      {/* body */}
      <div className="flex-1 overflow-y-auto px-7 py-5">
        {trimming ? (
          <TrimPanel rec={rec} onClose={() => setTrimming(false)} onSaved={() => { setTrimming(false); refresh(); }} />
        ) : (
          <>
            {tab === 'doc' && (
              <MeetingDoc
                rec={rec} groups={docGroups} outputByKey={outputByKey}
                templates={allTemplates} selectedIds={recTemplateIds}
                onTemplatesChange={setTemplates} onTemplatesReload={loadTemplates}
              />
            )}
            {tab === 'transcript' && (
              rec.transcript
                ? <div className="text-[13px] text-ink2 leading-relaxed whitespace-pre-wrap">{rec.transcript}</div>
                : <TabPlaceholder
                    icon="ear" pending preview
                    heading="Transcribing this recording…"
                    sub="The full transcript will appear here once speech-to-text finishes."
                    tips={[
                      { icon: 'search', text: 'Search across every transcript from the list on the left.' },
                      { icon: 'zap', text: 'When it lands, the copilot fills in your meeting document automatically.' },
                    ]}
                  />
            )}
            {tab === 'tasks' && (
              linked.length === 0
                ? <TabPlaceholder
                    icon="check" preview
                    heading="No action items yet"
                    sub="Tasks pulled from this recording show up here, linked back to the moment they came from."
                    tips={[
                      { icon: 'ear', text: 'Action items are extracted from the transcript once it’s ready.' },
                      { icon: 'chat', text: 'Or ask Curry Leaves in chat to pull todos from this recording.' },
                    ]}
                  />
                : (
                  <div className="flex flex-col gap-2">
                    {linked.map((t) => (
                      <div key={t.id} className="flex items-center gap-2 text-[13.5px]">
                        <span className={`flex-none ${t.done ? 'text-ok' : 'text-ink3'}`}><Icon name="check" size={15} /></span>
                        <span className={t.done ? 'line-through text-ink3' : 'text-ink'}>{t.text}</span>
                      </div>
                    ))}
                  </div>
                )
            )}
            {tab === 'context' && (
              <div className="max-w-[560px]">
                <RecordingContextPanel rec={rec} onChange={refresh} />
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ─── screen ─────────────────────────────────────────────────────────────────
export function RecordingsScreen({ recordings, todos, refresh, focusId, onFocusHandled }: {
  recordings: Recording[];
  todos: Todo[];
  refresh: () => void;
  focusId?: string | null;
  onFocusHandled?: () => void;
}) {
  const [sel, setSel] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  useEffect(() => { refresh(); /* eslint-disable-next-line */ }, []);

  // Orphaned drafts (crashed / closed mid-capture) needing a Save/Discard decision. Fetched
  // here rather than from the main list, which only carries finalized recordings. Re-checked
  // whenever the recordings list changes (a recover/discard, or a capture finishing).
  const [interrupted, setInterrupted] = useState<Recording[]>([]);
  const reloadInterrupted = () => api.listInterruptedRecordings().then(setInterrupted).catch(() => {});
  useEffect(() => { reloadInterrupted(); /* eslint-disable-line */ }, [recordings.length]);

  // Deep-link: a task/reminder backlink asked to focus a specific recording.
  useEffect(() => {
    if (!focusId) return;
    setFilter('all'); setQuery(''); setSel(focusId);
    onFocusHandled?.();
  }, [focusId]); // eslint-disable-line react-hooks/exhaustive-deps

  const list = useMemo(() => {
    return recordings.filter((r) => {
      if (filter === 'done' && !isDone(r)) return false;
      if (filter === 'active' && isDone(r)) return false;
      if (query && !`${r.name} ${r.transcript ?? ''} ${(r.tags ?? []).join(' ')}`.toLowerCase().includes(query.toLowerCase())) return false;
      return true;
    });
  }, [recordings, filter, query]);

  // keep a valid selection
  useEffect(() => {
    if (list.length === 0) { setSel(null); return; }
    if (!sel || !list.some((r) => r.id === sel)) setSel(list[0].id);
  }, [list, sel]);

  const selected = recordings.find((r) => r.id === sel) || null;
  const FILTERS: { id: Filter; label: string }[] = [
    { id: 'all', label: 'All' }, { id: 'active', label: 'Active' }, { id: 'done', label: 'Done' },
  ];

  return (
    <div className="flex-1 flex min-h-0 min-w-0">
      {/* list pane */}
      <div className="w-[340px] flex-none flex flex-col bg-bg border-r border-border">
        <div className="px-3 py-2.5 border-b border-border flex flex-col gap-2">
          <div className="flex items-center gap-2 h-8 px-2.5 rounded-[6px] bg-card border border-border">
            <Icon name="search" size={13} color="var(--color-ink3)" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search transcripts, tags…"
              className="flex-1 bg-transparent outline-none text-[12.5px] text-ink"
            />
          </div>
          <div className="flex gap-1 bg-sidebar border border-sidebar-border rounded-[6px] p-0.5 w-fit">
            {FILTERS.map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => setFilter(f.id)}
                className={`px-2.5 py-1 rounded-[4px] text-[11px] ${filter === f.id ? 'bg-card text-ink shadow-soft' : 'text-sidebar-ink3'}`}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto py-1.5 px-1.5 flex flex-col gap-0.5">
          {interrupted.length > 0 && (
            <div className="flex flex-col gap-1.5 mb-1.5">
              {interrupted.map((r) => (
                <InterruptedBanner key={r.id} rec={r} onChanged={() => { reloadInterrupted(); refresh(); }} />
              ))}
            </div>
          )}
          {list.length === 0 ? (
            interrupted.length === 0 && (
              <div className="px-5 py-10 text-center text-[11.5px] text-faint">
                {recordings.length === 0 ? 'No recordings yet — capture one to get started.' : 'No matches.'}
              </div>
            )
          ) : (
            list.map((r) => <Row key={r.id} rec={r} active={r.id === sel} onClick={() => setSel(r.id)} />)
          )}
        </div>
      </div>

      {/* detail pane */}
      {selected ? (
        <Detail rec={selected} todos={todos} refresh={refresh} onDeleted={() => { setSel(null); refresh(); }} />
      ) : (
        <div className="flex-1 flex items-center justify-center px-8">
          <TabPlaceholder
            icon="ear"
            heading={recordings.length === 0 ? 'No recordings yet' : 'Select a recording'}
            sub={recordings.length === 0
              ? 'Capture a meeting or note and it’ll show up here, ready to transcribe and summarize.'
              : 'Pick one from the list to see its summary, transcript, tasks, and notes.'}
            tips={recordings.length === 0
              ? [
                  { icon: 'mic', text: 'Hit record from the top bar to capture your first one.' },
                  { icon: 'bot', text: 'Bound agents summarize and pull action items automatically.' },
                ]
              : [
                  { icon: 'search', text: 'Search transcripts and tags from the box on the left.' },
                  { icon: 'bot', text: 'Each recording gets a tab per agent output — summary, tasks, and more.' },
                ]}
          />
        </div>
      )}
    </div>
  );
}
