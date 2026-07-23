import { useEffect, useRef, useState } from 'react';
import { Icon } from '../components/chrome/Icon';
import { useRecorder } from '../hooks/useRecorder';
import { useLiveTranscript } from '../hooks/useLiveTranscript';
import { CaughtPanels } from '../components/CaughtCard';
import { RecordingContextPanel } from '../components/RecordingContextPanel';
import { LiveCards } from '../components/LiveCards';
import { Markdown } from '../components/Markdown';
import { FallingLeaves } from '../components/FallingLeaves';
import { api } from '../api/client';
import { subscribeLiveContext, sendLiveSignal, sendLiveRefresh, attachLive, type LiveCard } from '../api/socket';
import type { MeetingTemplate, Recording, RecordingOutput, WhisperModelInfo } from '../types';
import type { Screen } from '../App';

const fmt = (s: number) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

function greeting(name?: string) {
  const h = new Date().getHours();
  const base = h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
  return name ? `${base}, ${name}` : base;
}

function ago(iso: string) {
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  return d === 1 ? 'Yesterday' : `${d}d ago`;
}

export function CaptureScreen({ active, onSaved, onNavigate, onOpenSettings }: {
  active: boolean;
  onSaved: () => void;
  onNavigate: (s: Screen) => void;
  onOpenSettings: (sectionId: string) => void;
}) {
  const rec = useRecorder();
  const [modelReady, setModelReady] = useState<boolean | null>(null);
  const [phase, setPhase] = useState<'idle' | 'saving' | 'done'>('idle');
  const [review, setReview] = useState<Recording | null>(null);
  // 'listen' behaves exactly like 'record' (same audio + transcript pipeline) except
  // Stop doesn't auto-finalize — it asks the user to save or discard first.
  const [mode, setMode] = useState<'record' | 'listen'>('record');
  const [confirmingStop, setConfirmingStop] = useState(false);
  const [discardAudio, setDiscardAudio] = useState(false);
  const [showTranscript, setShowTranscript] = useState(true);
  const [draftRec, setDraftRec] = useState<Recording | null>(null);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [deviceId, setDeviceId] = useState<string>(() => localStorage.getItem('micDeviceId') || '');
  const { transcript: live, streamId: liveStreamId } = useLiveTranscript(
    rec.isRecording, rec.isPaused, deviceId || undefined, rec.recordingId || undefined);

  // Keep the live transcript pinned to the newest speech as it streams in — but let go the
  // moment the user scrolls up to read something back, so we never yank them away mid-read.
  // Re-sticks when they scroll to the bottom again. Same pattern as AgentRunsPanel.
  const liveScrollRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  // A new recording starts pinned again, even if the user had scrolled up in the last one.
  useEffect(() => { stickToBottom.current = true; }, [rec.recordingId]);
  useEffect(() => {
    const el = liveScrollRef.current;
    if (!el) return;
    const onScroll = () => {
      stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, [rec.isRecording]);
  useEffect(() => {
    const el = liveScrollRef.current;
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight;
  }, [live]);

  // Attach the live engine once BOTH the audio stream and the recording id exist. The id can
  // land after the stream opens, so this runs order-independently (a plain recordingId on
  // audio.start would race and silently skip engaging the engine → no cards ever).
  useEffect(() => {
    if (liveStreamId && rec.recordingId) attachLive(liveStreamId, rec.recordingId);
  }, [liveStreamId, rec.recordingId]);

  // In-meeting live context cards from the backend engine, scoped to this recording.
  // Cards belong to ONE recording, so clear on every id change — not just when the id goes
  // away. useRecorder never resets recordingId to null (it goes A → B directly on the next
  // start), so a falsy-only guard would leave the previous meeting's cards on screen.
  const [liveCards, setLiveCards] = useState<LiveCard[]>([]);
  useEffect(() => {
    setLiveCards([]);
    if (!rec.recordingId) return;
    const off = subscribeLiveContext((recId, cards) => {
      if (recId !== rec.recordingId) return;
      setLiveCards((prev) => {
        const seen = new Set(prev.map((c) => c.text.toLowerCase()));
        const fresh = cards.filter((c) => !seen.has(c.text.toLowerCase()));
        return [...fresh, ...prev].slice(0, 6);  // newest first, capped
      });
    });
    return off;
  }, [rec.recordingId]);

  // Meeting templates: which one drives this recording's post-meeting outputs.
  const [templates, setTemplates] = useState<MeetingTemplate[]>([]);
  const [templateId, setTemplateId] = useState<string>('');
  const loadTemplates = () => api.listTemplates()
    .then((r) => { setTemplates(r.templates); setTemplateId((cur) => cur || r.defaultTemplateId || r.templates[0]?.id || ''); })
    .catch(() => {});
  useEffect(() => { loadTemplates(); }, []);

  const [userName, setUserName] = useState('');
  useEffect(() => { api.getSettings().then((s) => setUserName(s.identity?.name || '')).catch(() => {}); }, []);

  // Per-recording language override. Empty = fall back to Settings → Recording's default.
  const [languages, setLanguages] = useState<{ code: string; label: string }[]>([]);
  const [defaultLanguage, setDefaultLanguage] = useState<string>('');
  const [language, setLanguage] = useState<string>('');
  useEffect(() => {
    api.listModels().then((r) => { setLanguages(r.languages); setDefaultLanguage(r.language); }).catch(() => {});
  }, []);
  const defaultLanguageLabel = languages.find((l) => l.code === defaultLanguage)?.label || 'Auto-detect';

  useEffect(() => {
    const refresh = () => navigator.mediaDevices.enumerateDevices()
      .then((all) => setDevices(all.filter((d) => d.kind === 'audioinput')))
      .catch(() => {});
    refresh();
    navigator.mediaDevices.addEventListener('devicechange', refresh);
    return () => navigator.mediaDevices.removeEventListener('devicechange', refresh);
  }, []);

  const pickDevice = (id: string) => { setDeviceId(id); localStorage.setItem('micDeviceId', id); };

  const checkModel = () => api.listModels()
    .then((r: { models: WhisperModelInfo[] }) => setModelReady(r.models.some((m) => m.active && m.downloaded)))
    .catch(() => setModelReady(null));
  useEffect(() => { checkModel(); }, [rec.isRecording]);
  useEffect(() => { if (active) checkModel(); }, [active]);

  // Load the draft recording so the context panel (notes/links/docs/name), template, and
  // attendees can be edited live during the recording.
  useEffect(() => {
    if (rec.recordingId) api.getRecording(rec.recordingId).then(setDraftRec).catch(() => {});
    else setDraftRec(null);
  }, [rec.recordingId]);

  // The context panel PATCHes on its own; we just take the updated draft back. Adding an
  // attendee is a high-signal cue, so diff it here and nudge the live engine to pre-brief
  // them now — the panel has no socket of its own.
  const onDraftChange = (next: Recording) => {
    const before = draftRec?.attendees || [];
    setDraftRec(next);
    if (liveStreamId && next.attendees) {
      const added = next.attendees.filter((n) => !before.includes(n));
      if (added.length) sendLiveSignal(liveStreamId, added.join(', '));
    }
  };

  const dismissCard = (idx: number) => setLiveCards((prev) => prev.filter((_, i) => i !== idx));

  // Manual refresh: force the copilot to run a fresh pass now.
  const [refreshing, setRefreshing] = useState(false);
  const refreshCopilot = () => {
    if (!liveStreamId || refreshing) return;
    sendLiveRefresh(liveStreamId);
    setRefreshing(true);
    setTimeout(() => setRefreshing(false), 8000);  // safety clear if no cards come back
  };
  // Clear the refreshing state as soon as a fresh batch of cards lands.
  useEffect(() => { if (liveCards.length) setRefreshing(false); }, [liveCards]);

  // On stop: finalize → open the review card → backend transcribes → copilot fires.
  useEffect(() => {
    if (!rec.stoppedData) return;
    const { recordingId, duration } = rec.stoppedData;
    setPhase('saving');
    const custom = draftRec?.name?.trim();
    // Read the template off the draft — it's the authoritative value, since the context
    // panel can switch it mid-recording without going through `templateId`.
    const activeTpl = draftRec?.templateIds?.[0] || draftRec?.templateId || templateId;
    const tplName = templates.find((t) => t.id === activeTpl)?.name || 'Recording';
    const name = custom && custom !== 'Untitled recording'
      ? custom
      : `${tplName} · ${new Date().toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}`;
    api.finalizeRecording(recordingId, name, duration)
      .then((r) => { setReview(r); setPhase('idle'); onSaved(); })
      .catch(() => setPhase('idle'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rec.stoppedData]);

  // The copilot's non-summary sections (Decisions, Follow-up email, …) for the review screen.
  const [reviewOutputs, setReviewOutputs] = useState<RecordingOutput[]>([]);
  useEffect(() => {
    if (!review) { setReviewOutputs([]); return; }
    const load = () => api.listRecordingOutputs(review.id)
      .then((o) => setReviewOutputs(o.filter((x) => x.key !== 'meeting-summarizer')))
      .catch(() => {});
    load();
    const iv = setInterval(load, 2500);
    return () => clearInterval(iv);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [review?.id]);

  // While the review card is open, poll the recording until the summary lands.
  useEffect(() => {
    if (!review || review.summary) return;
    const iv = setInterval(() => {
      api.getRecording(review.id).then((r) => { if (r) setReview(r); onSaved(); }).catch(() => {});
    }, 2500);
    return () => clearInterval(iv);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [review?.id, review?.summary]);

  useEffect(() => {
    if (!discardAudio || !review?.id || !review.transcript || !review.audioPath) return;
    api.deleteAudio(review.id).then((r) => { if (r) setReview(r); onSaved(); }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [discardAudio, review?.id, review?.transcript, review?.audioPath]);

  const closeReview = () => { setReview(null); setPhase('idle'); };

  // ── Post-recording review ("Here's what I caught") ───────────────────────────
  if (review) {
    const tplName = templates.find((t) => t.id === review.templateId)?.name;
    return (
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-[760px] mx-auto px-8 py-10">
          {/* header — matches the app's serif-italic title style */}
          <div className="flex items-start justify-between gap-3 mb-1">
            <h1 className="font-serif italic text-[26px] text-ink leading-tight">Here's what I caught</h1>
            <button type="button" onClick={closeReview}
              className="flex-none px-3.5 py-2 rounded-[9px] border border-border bg-card text-ink2 text-[12.5px] hover:border-ink3 transition-colors">
              Save &amp; close
            </button>
          </div>
          <div className="flex items-center gap-2 mb-7 text-[12px] text-ink3">
            {tplName && <span className="px-2 py-0.5 rounded-full bg-accent-soft text-accent-ink text-[11px] font-550">{tplName}</span>}
            {review.duration != null && <span className="font-mono tabular-nums">{fmt(review.duration)}</span>}
            <span>·</span>
            <span>{ago(review.createdAt)}</span>
          </div>

          <div className="flex flex-col gap-5">
            {/* summary — label from the template's summary section (e.g. Brainstorm's "Ideas raised") */}
            <ReviewCard
              label={templates.find((t) => t.id === review.templateId)?.sections.find((s) => s.id === 'summary')?.title || 'Summary'}
              icon="sparkle">
              {review.summary
                ? <Markdown text={review.summary} textSize="text-[13px]" />
                : <div className="text-[13px] text-ink3 italic an-pulse">{review.transcript ? 'Summarizing…' : 'Transcribing…'}</div>}
            </ReviewCard>

            {/* template sections (Decisions, Follow-up email, …) */}
            {reviewOutputs.map((o) => (
              <ReviewCard key={o.key} label={o.title} icon="file">
                <Markdown text={o.content} textSize="text-[13px]" />
              </ReviewCard>
            ))}

            {/* tasks + reminders */}
            <CaughtPanels rec={review} live hideSummary onOpen={() => { closeReview(); onNavigate('recordings'); }} />

            {/* transcript */}
            <div className="rounded-[14px] border border-border bg-card overflow-hidden">
              <button type="button" onClick={() => setShowTranscript((v) => !v)}
                className={`w-full flex items-center justify-between px-5 py-3.5 text-left ${showTranscript ? 'border-b border-border-soft' : ''}`}>
                <span className="text-[10.5px] uppercase tracking-wider text-ink3 font-600">Transcript</span>
                <Icon name={showTranscript ? 'chevD' : 'chevR'} size={14} color="var(--color-ink3)" />
              </button>
              {showTranscript && (
                <div className="px-5 py-4 text-[13px] text-ink2 leading-relaxed whitespace-pre-wrap max-h-[440px] overflow-y-auto">
                  {review.transcript || <span className="text-ink3 italic an-pulse">Transcribing…</span>}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── Live recording view — content first ──────────────────────────────────────
  if (rec.isRecording) {
    return (
      <div className="flex-1 flex flex-col min-h-0 px-8 py-5 select-none">
        {/* header: one quiet strip — dot, timer, level meter, transport controls, retention.
            Template & attendees live in the right context panel. */}
        <div className="flex items-center gap-3 mb-4 flex-none flex-wrap">
          <span className="an-pulse w-2 h-2 rounded-full bg-rec flex-none" />
          <span className="text-[12px] font-mono uppercase tracking-wide text-rec font-600">{mode === 'listen' ? 'Listen' : 'Rec'}</span>
          <span className="text-[16px] font-mono text-ink tabular-nums">{fmt(rec.recordingTime)}</span>
          {/* the waveform, demoted to a compact level meter — proof audio is flowing */}
          <canvas ref={rec.canvasRef} className="w-[80px] h-[22px] flex-none" />

          {/* transport controls — right beside the waveform, so stopping is always within
              reach of the thing that says you're recording */}
          {confirmingStop ? (
            <div className="flex items-center gap-2 flex-none">
              <span className="text-[12px] text-ink2">Save this conversation?</span>
              <button type="button" onClick={() => { setConfirmingStop(false); rec.cancel(); }}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-[8px] border border-border text-[12px] text-ink3 hover:border-rec hover:text-rec">
                <Icon name="x" size={13} /> Discard
              </button>
              <button type="button" onClick={() => { setConfirmingStop(false); rec.stop(); }}
                className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-[8px] bg-accent text-white text-[12px] font-550 hover:bg-accent-dark">
                <Icon name="check" size={13} /> Save &amp; summarize
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2 flex-none">
              <button type="button" title="Discard this recording"
                onClick={() => { if (confirm('Cancel and discard this recording? This can\'t be undone.')) rec.cancel(); }}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-[8px] border border-border text-[12px] text-ink3 hover:border-rec hover:text-rec">
                <Icon name="x" size={13} /> Cancel
              </button>
              {rec.isPaused ? (
                <button type="button" onClick={rec.resume} className="flex items-center gap-1.5 px-3 py-1.5 rounded-[8px] bg-card border border-border text-[12px] text-ink2 hover:border-ink3">
                  <Icon name="play" size={13} /> Resume
                </button>
              ) : (
                <button type="button" onClick={rec.pause} className="flex items-center gap-1.5 px-3 py-1.5 rounded-[8px] bg-card border border-border text-[12px] text-ink2 hover:border-ink3">
                  <Icon name="pause" size={13} /> Pause
                </button>
              )}
              {mode === 'listen' ? (
                <button type="button" onClick={() => { rec.pause(); setConfirmingStop(true); }} className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-[8px] bg-accent text-white text-[12px] font-550 hover:bg-accent-dark">
                  <Icon name="stop" size={13} /> Stop
                </button>
              ) : (
                <button type="button" onClick={rec.stop} className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-[8px] bg-accent text-white text-[12px] font-550 hover:bg-accent-dark">
                  <Icon name="stop" size={13} /> Stop &amp; summarize
                </button>
              )}
            </div>
          )}

          <label className="ml-auto flex items-center gap-1.5 text-[12px] text-ink3 cursor-pointer select-none flex-none" title="File this meeting into long-term knowledge">
            <input type="checkbox" checked={draftRec?.saveToKnowledge ?? true} disabled={!draftRec}
              onChange={(e) => {
                if (!draftRec) return;
                const v = e.target.checked;
                setDraftRec({ ...draftRec, saveToKnowledge: v });
                api.updateRecording(draftRec.id, { saveToKnowledge: v }).then(setDraftRec).catch(() => {});
              }}
              className="w-3.5 h-3.5 accent-accent cursor-pointer" />
            Save to Knowledge Hub
          </label>
          <label className="flex items-center gap-1.5 text-[12px] text-ink3 cursor-pointer select-none flex-none" title="Delete the audio file once it's transcribed — keeps only the transcript">
            <input type="checkbox" checked={discardAudio} onChange={(e) => setDiscardAudio(e.target.checked)} className="w-3.5 h-3.5 accent-accent cursor-pointer" />
            Don't store audio
          </label>
        </div>

        {/* 3 columns: LEFT copilot (loops, tips, guidance) · CENTER transcript (widest) · RIGHT context */}
        <div className="flex-1 flex gap-4 min-h-0">
          {/* left: the meeting copilot — what helps the user drive the meeting */}
          <div className="w-[280px] flex-none min-h-0 rounded-[14px] border border-border bg-card shadow-soft flex flex-col">
            <div className="flex items-center gap-1.5 px-4 pt-4 pb-2.5 flex-none border-b border-border-soft">
              <Icon name="sparkle" size={13} color="var(--color-accent)" />
              <span className="text-[11px] uppercase tracking-wider text-ink3 font-600 flex-1">Copilot</span>
              {liveCards.length > 0 && <span className="text-[11px] text-ink3">{liveCards.length}</span>}
              {liveStreamId && (
                <button type="button" onClick={refreshCopilot} disabled={refreshing}
                  title="Get fresh suggestions now"
                  className="text-ink3 hover:text-accent disabled:opacity-50 flex-none">
                  <span className={refreshing ? 'inline-block an-spin' : ''}><Icon name="refresh" size={13} /></span>
                </button>
              )}
            </div>
            <div className="flex-1 overflow-y-auto px-3 py-3">
              {liveCards.length > 0 ? (
                <LiveCards cards={liveCards} onDismiss={dismissCard} />
              ) : (
                <div className="text-[12px] text-ink3 leading-relaxed px-1 pt-1">
                  {liveStreamId
                    ? 'Watching the conversation — open loops, reminders, questions to ask, and tips will appear here as they come up.'
                    : 'Your in-meeting copilot appears here once recording starts.'}
                </div>
              )}
            </div>
          </div>

          {/* center: transcript — takes the most space */}
          <div className="flex-1 min-w-0 min-h-0 rounded-[14px] border border-border bg-card shadow-soft flex flex-col">
            <div className="flex items-center justify-between px-6 pt-4 pb-2.5 flex-none border-b border-border-soft">
              <span className="text-[11px] uppercase tracking-wider text-ink3 font-600">Live transcript</span>
              <span className="flex items-center gap-1.5 text-[11.5px] text-ink3">
                <span className={`w-1.5 h-1.5 rounded-full ${rec.isPaused ? 'bg-ink3' : 'an-pulse bg-ok'}`} />
                {rec.isPaused ? 'Paused' : 'Listening'}
              </span>
            </div>
            <div ref={liveScrollRef} className="flex-1 overflow-y-auto px-6 py-5">
              {modelReady === false ? (
                <div className="flex items-center gap-2.5 px-3 py-2.5 rounded-[10px] border border-amber-500/40 bg-amber-500/10 text-amber-700">
                  <span className="flex-none"><Icon name="warning" size={14} /></span>
                  <span className="flex-1 text-[12.5px] leading-snug">No transcription model downloaded — audio is still being recorded.</span>
                  <button type="button" onClick={() => onOpenSettings('recording')} className="flex-none text-[12px] font-550 underline underline-offset-2 hover:opacity-80">Set up →</button>
                </div>
              ) : !live ? (
                <div className="text-[13px] text-ink3 italic">Listening for speech…</div>
              ) : (
                <p className="text-[15px] text-ink leading-[1.85] whitespace-pre-wrap max-w-[68ch] mx-auto">
                  {live}
                  <span className="an-blink inline-block w-[2px] h-[16px] bg-accent align-middle ml-0.5" />
                </p>
              )}
            </div>
            {/* live note composer — pins a timestamped note into the recording */}
            <NoteComposer recId={rec.recordingId} elapsed={rec.recordingTime} streamId={liveStreamId} />
          </div>

          {/* right: context panel (name, attendees, notes, links, docs) — unchanged */}
          {draftRec && (
            <div className="w-[300px] flex-none overflow-y-auto rounded-[14px] border border-border bg-card shadow-soft p-4">
              <RecordingContextPanel
                rec={draftRec}
                onChange={onDraftChange}
                templates={templates}
                onTemplatesChanged={loadTemplates}
                hideKnowledgeToggle
              />
            </div>
          )}
        </div>

      </div>
    );
  }

  // ── Idle landing ─────────────────────────────────────────────────────────────
  return (
    <div className="relative flex-1 overflow-y-auto flex flex-col justify-center">
      <FallingLeaves />
      <div className="relative z-10 max-w-[640px] mx-auto px-8 py-14 flex flex-col items-center w-full">
        <h1 className="font-serif text-[32px] text-ink text-center leading-tight">{greeting(userName)}</h1>
        <p className="text-[14px] text-ink3 text-center mt-1.5">Record a meeting, dump a thought, or just listen.</p>

        {modelReady === false && (
          <div className="w-full flex items-center gap-3 mt-7 px-4 py-3 rounded-[12px] border border-amber-500/40 bg-amber-500/10 text-amber-700">
            <span className="flex-none"><Icon name="warning" size={16} /></span>
            <div className="flex-1 text-[13px] leading-snug">
              Transcription isn't active — no speech-to-text model is downloaded yet. You can still record, but the transcript will be empty.
            </div>
            <button type="button" onClick={() => onOpenSettings('recording')}
              className="flex-none text-[12.5px] font-550 px-3 py-1.5 rounded-[8px] border border-amber-500/40 hover:bg-amber-500/15">
              Set up model →
            </button>
          </div>
        )}

        {/* record / listen buttons */}
        <div className="flex items-center gap-6 mt-10">
          <button type="button" title="Start recording"
            onClick={() => { setMode('record'); setConfirmingStop(false); setDiscardAudio(false); rec.start(deviceId || undefined, templateId || undefined, language || undefined); }}
            className="flex flex-col items-center gap-2.5 group cursor-pointer">
            <span className={`w-[96px] h-[96px] rounded-[24px] bg-accent text-white flex items-center justify-center shadow-pop group-hover:bg-rec transition-colors ${phase === 'saving' ? 'shimmer' : 'an-breathe'}`}>
              <Icon name="mic" size={34} />
            </span>
            <span className="text-[13px] font-550 text-ink2">Record</span>
          </button>
          <button type="button" title="Just listen — decide to save or discard when you stop"
            onClick={() => { setMode('listen'); setConfirmingStop(false); setDiscardAudio(false); rec.start(deviceId || undefined, templateId || undefined, language || undefined); }}
            className="flex flex-col items-center gap-2.5 group cursor-pointer">
            <span className={`w-[96px] h-[96px] rounded-[24px] bg-accent-dark text-white flex items-center justify-center shadow-pop group-hover:bg-rec transition-colors ${phase === 'saving' ? 'shimmer' : 'an-breathe'}`}>
              <Icon name="ear" size={34} />
            </span>
            <span className="text-[13px] font-550 text-ink2">Listen</span>
          </button>
        </div>
        <div className="text-[12.5px] text-ink3 mt-5 h-5">
          {phase === 'saving' ? 'Transcribing… the copilot will pick it up'
            : phase === 'done' ? 'Saved ✓ — see Recordings'
            : 'Record saves automatically · Listen lets you choose · ⌘R to jump here'}
        </div>
        {rec.error && <div className="text-[12.5px] text-rec mt-2 text-center">{rec.error}</div>}

        {/* what happens when you stop — the pipeline, stated plainly */}
        <div className="w-full grid grid-cols-3 gap-3 mt-10 pt-6 border-t border-border-soft">
          <PipeStep title="Transcribed on this Machine" desc="Whisper runs locally; attendee names sharpen accuracy." />
          <PipeStep title="Pick a template as you record" desc="Choose (or describe) the meeting type in the header — it decides your outputs." />
          <PipeStep title="Loops open & close" desc="Action items become todos; people and topics get filed to knowledge." />
        </div>

        {/* quiet utility chips — mic, language, retention */}
        <div className="w-full flex items-center gap-2 flex-wrap justify-center mt-6">
          <div className="relative inline-flex items-center">
            <span className="pointer-events-none absolute left-2.5 text-ink3"><Icon name="mic" size={12} /></span>
            <select value={deviceId} onChange={(e) => pickDevice(e.target.value)} title="Microphone"
              className="appearance-none pl-7 pr-7 py-1.5 rounded-full border border-border bg-card text-[12px] text-ink2 outline-none cursor-pointer max-w-[240px] truncate hover:border-ink3">
              <option value="">Default microphone</option>
              {devices.map((d, i) => <option key={d.deviceId} value={d.deviceId}>{d.label || `Microphone ${i + 1}`}</option>)}
            </select>
            <span className="pointer-events-none absolute right-2.5 rotate-90 text-ink3"><Icon name="chevR" size={11} /></span>
          </div>

          {languages.length > 0 && (
            <div className="relative inline-flex items-center">
              <span className="pointer-events-none absolute left-2.5 text-ink3"><Icon name="globe" size={12} /></span>
              <select value={language} onChange={(e) => setLanguage(e.target.value)}
                title="Transcription language for this recording (defaults to Settings → Recording)"
                className="appearance-none pl-7 pr-7 py-1.5 rounded-full border border-border bg-card text-[12px] text-ink2 outline-none cursor-pointer max-w-[200px] truncate hover:border-ink3">
                <option value="">Settings default ({defaultLanguageLabel})</option>
                {languages.map((l) => <option key={l.code} value={l.code}>{l.label}</option>)}
              </select>
              <span className="pointer-events-none absolute right-2.5 rotate-90 text-ink3"><Icon name="chevR" size={11} /></span>
            </div>
          )}

          <button type="button" onClick={() => onOpenSettings('templates')}
            className="px-3 py-1.5 rounded-full border border-border bg-card text-[12px] text-ink3 hover:border-ink3 inline-flex items-center gap-1.5">
            <Icon name="sparkle" size={12} /> Manage templates
          </button>
        </div>
      </div>
    </div>
  );
}

/** One section card on the review screen — a consistently-styled uppercase label + body, so
 *  Summary, Decisions, Follow-up email, etc. all read as one family. */
function ReviewCard({ label, icon, children }: { label: string; icon: string; children: React.ReactNode }) {
  return (
    <div className="rounded-[14px] border border-border bg-card px-5 py-4">
      <div className="flex items-center gap-1.5 mb-2.5 text-ink3">
        <Icon name={icon} size={13} color="var(--color-accent)" />
        <span className="text-[10.5px] uppercase tracking-wider font-600">{label}</span>
      </div>
      {children}
    </div>
  );
}

function PipeStep({ title, desc }: { title: string; desc: string }) {
  return (
    <div className="text-left">
      <div className="text-[12px] font-550 text-ink">{title}</div>
      <div className="text-[11px] text-ink3 leading-snug mt-0.5">{desc}</div>
    </div>
  );
}

/** A timestamped note typed during the meeting — pinned into the recording's notes with an
 *  elapsed-time marker, so it reads back alongside the transcript moment it was written. Also
 *  nudges the live engine, since a typed note is the strongest signal of what matters. */
function NoteComposer({ recId, elapsed, streamId }: { recId: string | null; elapsed: number; streamId: string | null }) {
  const [text, setText] = useState('');
  const [saved, setSaved] = useState(false);

  const submit = async () => {
    const note = text.trim();
    if (!note || !recId) return;
    try {
      const cur = await api.getRecording(recId);
      const stamp = fmt(elapsed);
      const prev = (cur?.notes || '').trim();
      const line = `[${stamp}] ${note}`;
      await api.updateRecording(recId, { notes: prev ? `${prev}\n${line}` : line });
      if (streamId) sendLiveSignal(streamId, note);
      setText('');
      setSaved(true);
      setTimeout(() => setSaved(false), 1200);
    } catch { /* non-blocking — a dropped note shouldn't interrupt recording */ }
  };

  return (
    <div className="flex items-center gap-2 px-4 py-2.5 border-t border-border-soft flex-none">
      <Icon name="edit" size={13} color="var(--color-ink3)" />
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
        placeholder="Type a note — it pins to this moment…"
        className="flex-1 bg-transparent text-[12.5px] text-ink outline-none placeholder:text-ink3"
      />
      <span className="text-[11px] text-ink3 tabular-nums">{saved ? 'Pinned ✓' : fmt(elapsed)}</span>
    </div>
  );
}
