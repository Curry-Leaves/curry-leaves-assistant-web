import { useEffect, useRef, useState } from 'react';
import { Icon } from '../chrome/Icon';
import { api } from '../../api/client';
import { decodeAudio, concatToWav } from './wav';
import type { Recording } from '../../types';

const fmt = (s: number) => (isFinite(s) && s >= 0 ? `${Math.floor(s / 60)}:${Math.floor(s % 60).toString().padStart(2, '0')}` : '--:--');

/** Inline audio player for a recording: play/seek, add a follow-up clip, trim, delete.
 *  Audio is served over HTTP from the backend (the edited mono WAV if one exists). */
export function AudioPlayer({ rec, onEditAudio, onChanged }: {
  rec: Recording;
  onEditAudio: () => void;
  onChanged: () => void;
}) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  if (!audioRef.current) audioRef.current = new Audio();
  const [playing, setPlaying] = useState(false);
  const [cur, setCur] = useState(0);
  const [total, setTotal] = useState(rec.duration ?? 0);
  const [deleteStep, setDeleteStep] = useState(0);
  const delTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [recording, setRecording] = useState(false);
  const [busy, setBusy] = useState<null | string>(null);
  const mrRef = useRef<MediaRecorder | null>(null);

  // Point the <audio> at the backend URL; cache-bust on duration change (edits change it).
  useEffect(() => {
    let alive = true;
    const a = audioRef.current!;
    a.pause(); setPlaying(false); setCur(0); setTotal(rec.duration ?? 0);
    api.audioUrl(rec.id, rec.duration ?? 0).then((u) => { if (alive) a.src = u; });
    return () => { alive = false; };
  }, [rec.id, rec.duration]);

  useEffect(() => {
    const a = audioRef.current!;
    const onTime = () => setCur(a.currentTime);
    const onDur = () => { if (isFinite(a.duration)) setTotal(a.duration); };
    const onEnd = () => { setPlaying(false); setCur(0); a.currentTime = 0; };
    a.addEventListener('timeupdate', onTime);
    a.addEventListener('durationchange', onDur);
    a.addEventListener('ended', onEnd);
    return () => {
      a.removeEventListener('timeupdate', onTime);
      a.removeEventListener('durationchange', onDur);
      a.removeEventListener('ended', onEnd);
      a.pause();
    };
  }, []);

  const toggle = async () => {
    const a = audioRef.current!;
    if (playing) { a.pause(); setPlaying(false); }
    else { try { await a.play(); setPlaying(true); } catch { /* no audio */ } }
  };

  const seek = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!total) return;
    const rect = e.currentTarget.getBoundingClientRect();
    audioRef.current!.currentTime = ((e.clientX - rect.left) / rect.width) * total;
  };

  // ── Add a follow-up recording, appended to the existing audio ───────────────
  const toggleRecord = async () => {
    if (recording) { mrRef.current?.stop(); return; }
    let stream: MediaStream;
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); }
    catch { return; }
    const mr = new MediaRecorder(stream);
    const chunks: BlobPart[] = [];
    mr.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    mr.onstop = async () => {
      stream.getTracks().forEach((t) => t.stop());
      setRecording(false);
      setBusy('Appending…');
      try {
        const addBuf = await decodeAudio(await new Blob(chunks).arrayBuffer());
        const existing = await fetch(await api.audioUrl(rec.id, rec.duration ?? 0))
          .then((r) => (r.ok ? r.arrayBuffer() : null))
          .then((ab) => (ab ? decodeAudio(ab) : null))
          .catch(() => null);
        const { wav, duration } = concatToWav(existing ? [existing, addBuf] : [addBuf]);
        await api.saveAudio(rec.id, wav, duration);
        onChanged();
      } catch { /* ignore */ } finally { setBusy(null); }
    };
    mrRef.current = mr;
    mr.start();
    setRecording(true);
  };

  const handleDelete = async () => {
    if (deleteStep === 0) {
      setDeleteStep(1);
      delTimer.current = setTimeout(() => setDeleteStep(0), 3000);
      return;
    }
    if (delTimer.current) clearTimeout(delTimer.current);
    setDeleteStep(2);
    audioRef.current!.pause(); setPlaying(false);
    try { await api.deleteAudio(rec.id); onChanged(); } catch { /* ignore */ }
    setDeleteStep(0);
  };

  const pct = total > 0 ? (cur / total) * 100 : 0;
  const hasAudio = !!rec.audioPath || rec.status === 'saved' || rec.duration != null;
  if (!hasAudio && deleteStep === 0) return null;

  return (
    <div className="flex items-center gap-2.5 px-3 py-2 mt-2 rounded-[10px] border border-sidebar-border bg-sidebar">
      {/* play / pause */}
      <button type="button" onClick={toggle} title={playing ? 'Pause' : 'Play'}
        className="w-7 h-7 rounded-full flex-none grid place-items-center bg-accent text-on-accent">
        <Icon name={playing ? 'pause' : 'play'} size={11} color="var(--color-on-accent)" />
      </button>

      <span className="font-mono text-[10.5px] text-sidebar-ink3 flex-none w-8">{fmt(cur)}</span>

      <div onClick={seek} className="flex-1 h-[3px] rounded bg-sidebar-border cursor-pointer relative">
        <div className="absolute inset-0 bg-accent rounded" style={{ right: `${100 - pct}%` }} />
      </div>

      <span className="font-mono text-[10.5px] text-sidebar-ink3 flex-none w-8 text-right">{fmt(total)}</span>

      {busy ? (
        <span className="text-[11px] text-sidebar-ink3 px-2 an-pulse">{busy}</span>
      ) : (
        <>
          {/* add recording */}
          <button type="button" onClick={toggleRecord} title="Record more audio to append"
            className={`h-6 px-2 rounded-[5px] flex-none flex items-center gap-1 border text-[11px] ${
              recording ? 'border-rec text-rec bg-rec/10' : 'border-sidebar-border text-sidebar-ink3 hover:border-sidebar-ink3 hover:text-sidebar-ink'}`}>
            <Icon name={recording ? 'stop' : 'mic'} size={11} color={recording ? 'var(--color-rec)' : 'currentColor'} />
            {recording ? 'Stop' : 'Add'}
          </button>

          {/* trim */}
          <button type="button" onClick={onEditAudio} title="Trim audio"
            className="h-6 px-2 rounded-[5px] flex-none flex items-center gap-1 border border-sidebar-border text-sidebar-ink3 text-[11px] hover:border-sidebar-ink3 hover:text-sidebar-ink">
            <Icon name="edit" size={11} color="currentColor" /> Trim
          </button>

          {/* delete audio */}
          <button type="button" onClick={handleDelete} disabled={deleteStep === 2} title={deleteStep ? 'Click again to confirm' : 'Delete audio file'}
            className={`h-6 px-2 rounded-[5px] flex-none flex items-center gap-1 border text-[11px] ${
              deleteStep === 1 ? 'border-rec/50 text-rec bg-rec/10' : 'border-sidebar-border text-sidebar-ink3 hover:border-sidebar-ink3 hover:text-sidebar-ink'}`}>
            <Icon name="trash" size={11} color={deleteStep === 1 ? 'var(--color-rec)' : 'currentColor'} />
            {deleteStep === 1 ? 'Confirm' : 'Delete'}
          </button>
        </>
      )}
    </div>
  );
}
