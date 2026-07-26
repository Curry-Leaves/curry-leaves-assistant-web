import { useCallback, useEffect, useRef, useState } from 'react';
import { Icon } from '../chrome/Icon';
import { api } from '../../api/client';
import { keepRegionsToWav } from './wav';
import type { Recording } from '../../types';

type Region = { id: string; start: number; end: number };

const COLORS = ['#7c6cf0', '#3aa897', '#d08a2c', '#c25aa0', '#6aa83a', '#3a78c2'];
const color = (i: number) => COLORS[i % COLORS.length];
const fmtT = (s: number) => `${Math.floor(s / 60)}:${Math.floor(s % 60).toString().padStart(2, '0')}.${Math.floor((s % 1) * 10)}`;

/** Trim a recording's audio by selecting one or more regions to KEEP (drag on the
 *  waveform). Saves the concatenated regions as a new mono WAV → re-transcribes.
 *  Renders inline (in the space below the player), not as a modal. */
export function TrimPanel({ rec, onClose, onSaved }: {
  rec: Recording;
  onClose: () => void;
  onSaved: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const acRef = useRef<AudioContext | null>(null);
  const abRef = useRef<AudioBuffer | null>(null);
  const srcsRef = useRef<AudioBufferSourceNode[]>([]);
  const afRef = useRef(0);
  const playingRef = useRef(false);
  const peaksRef = useRef<Float32Array | null>(null);
  const anchorRef = useRef(0);

  const [loading, setLoading] = useState(true);
  const [duration, setDuration] = useState(0);
  const [regions, setRegions] = useState<Region[]>([]);
  const [drag, setDrag] = useState<Region | null>(null);
  const [playhead, setPlayhead] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [saving, setSaving] = useState(false);
  const [seq, setSeq] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const url = await api.audioUrl(rec.id, rec.duration ?? 0);
      const raw = await fetch(url).then((r) => r.arrayBuffer());
      const ac = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
      acRef.current = ac;
      const decoded = await ac.decodeAudioData(raw.slice(0));
      if (cancelled) { ac.close(); return; }
      abRef.current = decoded;
      const N = 900, data = decoded.getChannelData(0), peaks = new Float32Array(N), spx = data.length / N;
      for (let x = 0; x < N; x++) {
        let max = 0;
        for (let i = Math.floor(x * spx); i < Math.floor((x + 1) * spx); i++) { const v = Math.abs(data[i]); if (v > max) max = v; }
        peaks[x] = max;
      }
      peaksRef.current = peaks;
      setDuration(decoded.duration);
      setLoading(false);
    })().catch(() => setLoading(false));
    return () => {
      cancelled = true;
      srcsRef.current.forEach((s) => { try { s.stop(); } catch { /* ignore */ } });
      acRef.current?.close();
      cancelAnimationFrame(afRef.current);
    };
  }, [rec.id, rec.duration]);

  const css = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim() || '#888';

  const draw = useCallback((ph: number, committed: Region[], live: Region | null) => {
    const canvas = canvasRef.current, peaks = peaksRef.current;
    if (!canvas || !peaks || duration === 0) return;
    const ctx = canvas.getContext('2d')!;
    const W = canvas.width, H = canvas.height, TLINE = 22, wH = H - TLINE, mid = wH / 2;
    const hair = css('--color-sidebar-border'), muted = css('--color-sidebar-ink3'), ink = css('--color-sidebar-ink');
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = hair;
    for (let x = 0; x < peaks.length; x++) {
      const bh = Math.max(1, peaks[x] * mid * 0.9);
      ctx.fillRect(Math.round((x / peaks.length) * W), mid - bh, 1, bh * 2);
    }
    committed.forEach((r, i) => {
      const col = color(i), x1 = (r.start / duration) * W, x2 = (r.end / duration) * W;
      ctx.globalAlpha = 0.18; ctx.fillStyle = col; ctx.fillRect(x1, 0, x2 - x1, wH);
      ctx.globalAlpha = 1; ctx.fillRect(x1, 0, 2, wH); ctx.fillRect(x2 - 2, 0, 2, wH);
    });
    if (live) {
      const x1 = (live.start / duration) * W, x2 = (live.end / duration) * W;
      ctx.globalAlpha = 0.1; ctx.fillStyle = muted; ctx.fillRect(x1, 0, x2 - x1, wH);
      ctx.globalAlpha = 1; ctx.fillRect(x1, 0, 1.5, wH); ctx.fillRect(x2 - 1.5, 0, 1.5, wH);
    }
    const phX = (ph / duration) * W;
    ctx.fillStyle = ink; ctx.globalAlpha = 0.65; ctx.fillRect(phX, 0, 1.5, wH); ctx.globalAlpha = 1;
    // timeline
    ctx.fillStyle = hair; ctx.globalAlpha = 0.6; ctx.fillRect(0, wH, W, 1); ctx.globalAlpha = 1;
    const STEPS = [0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600];
    const tickSec = STEPS.find((v) => v >= duration / 10) ?? 600;
    ctx.font = '9px Inter, sans-serif'; ctx.textBaseline = 'middle';
    for (let ts = 0; ts <= duration + 0.001; ts += tickSec) {
      const x = Math.round((ts / duration) * W); if (x > W) break;
      ctx.fillStyle = muted; ctx.globalAlpha = 0.45; ctx.fillRect(x, wH + 1, 1, 5); ctx.globalAlpha = 1;
      const mins = Math.floor(ts / 60), secs = Math.round(ts % 60);
      const label = mins > 0 ? `${mins}:${String(secs).padStart(2, '0')}` : `${secs}s`;
      ctx.fillStyle = muted; ctx.textAlign = 'center'; ctx.globalAlpha = 0.7;
      ctx.fillText(label, Math.max(12, Math.min(W - 12, x)), wH + 14); ctx.globalAlpha = 1;
    }
  }, [duration]);

  useEffect(() => { draw(playhead, regions, drag); }, [draw, playhead, regions, drag]);

  const getTime = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * duration;
  };
  const onDown = (e: React.MouseEvent<HTMLCanvasElement>) => { const t = getTime(e); anchorRef.current = t; setDrag({ id: '', start: t, end: t }); };
  const onMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!drag) return;
    const t = getTime(e);
    setDrag({ id: '', start: Math.min(anchorRef.current, t), end: Math.max(anchorRef.current, t) });
  };
  const onUp = () => {
    if (drag && drag.end - drag.start > 0.1) {
      setRegions((p) => [...p, { ...drag, id: `r${seq}` }]);
      setSeq((n) => n + 1);
    }
    setDrag(null);
  };

  const stopAll = () => {
    srcsRef.current.forEach((s) => { try { s.stop(); } catch { /* ignore */ } });
    srcsRef.current = []; cancelAnimationFrame(afRef.current); playingRef.current = false; setPlaying(false);
  };

  const togglePlay = async () => {
    if (playing) { stopAll(); return; }
    const ac = acRef.current, ab = abRef.current;
    if (!ac || !ab || regions.length === 0) return;
    await ac.resume();
    const sorted = [...regions].sort((a, b) => a.start - b.start);
    let at = ac.currentTime + 0.02;
    const srcs: AudioBufferSourceNode[] = [];
    for (const r of sorted) {
      const src = ac.createBufferSource(); src.buffer = ab; src.connect(ac.destination);
      src.start(at, r.start, r.end - r.start); at += r.end - r.start; srcs.push(src);
    }
    srcsRef.current = srcs;
    const segStart = ac.currentTime + 0.02; playingRef.current = true; setPlaying(true);
    const tick = () => {
      if (!playingRef.current) return;
      let remaining = ac.currentTime - segStart, ph = sorted[0].start;
      for (const r of sorted) { const len = r.end - r.start; if (remaining <= len) { ph = r.start + remaining; break; } remaining -= len; ph = r.end; }
      setPlayhead(ph); afRef.current = requestAnimationFrame(tick);
    };
    afRef.current = requestAnimationFrame(tick);
    srcs[srcs.length - 1].onended = () => { if (playingRef.current) { stopAll(); setPlayhead(sorted[0].start); } };
  };

  const save = async () => {
    const ab = abRef.current;
    if (!ab || saving || regions.length === 0) return;
    setSaving(true);
    try {
      const { wav, duration: dur } = keepRegionsToWav(ab, regions);
      await api.saveAudio(rec.id, wav, dur);
      onSaved();
    } finally { setSaving(false); }
  };

  const totalSel = regions.reduce((n, r) => n + (r.end - r.start), 0);
  const has = regions.length > 0;
  const sorted = [...regions].sort((a, b) => a.start - b.start);

  return (
    <div className="rounded-[14px] bg-card border border-border flex flex-col overflow-hidden">
      <div className="px-5 py-4 border-b border-border flex items-center">
        <div className="flex-1">
          <div className="font-serif text-[16px] text-ink">Trim Audio</div>
          <div className="text-[11.5px] text-ink3 mt-0.5">{rec.name} · drag to select regions to keep</div>
        </div>
        <button type="button" onClick={onClose} title="Close" className="p-1 rounded text-ink3 hover:bg-border-soft hover:text-ink"><Icon name="x" size={16} color="currentColor" /></button>
      </div>

      <div className="px-6 py-5 flex flex-col gap-3.5">
        {loading ? (
            <div className="h-[120px] rounded-[10px] bg-sidebar grid place-items-center text-[13px] text-sidebar-ink3 italic">Decoding audio…</div>
          ) : (
            <>
              <div>
                <canvas ref={canvasRef} width={852} height={142}
                  className="w-full h-[142px] rounded-[10px] cursor-crosshair block bg-sidebar"
                  onMouseDown={onDown} onMouseMove={onMove} onMouseUp={onUp} onMouseLeave={onUp} />
                <div className="flex items-center gap-2.5 mt-2">
                  <button type="button" onClick={togglePlay} disabled={!has} title={playing ? 'Stop' : 'Preview selected regions'}
                    className={`w-8 h-8 rounded-full flex-none grid place-items-center ${has ? 'bg-accent text-on-accent' : 'bg-border text-ink3 cursor-not-allowed'}`}>
                    <Icon name={playing ? 'pause' : 'play'} size={13} color={has ? 'var(--color-on-accent)' : 'var(--color-ink3)'} />
                  </button>
                  <span className="font-mono text-[10.5px] text-accent-dark min-w-[44px]">{fmtT(playhead)}</span>
                  <div className="flex-1 h-[2px] rounded bg-border relative">
                    <div className="absolute inset-0 bg-accent rounded" style={{ right: `${100 - (duration > 0 ? (playhead / duration) * 100 : 0)}%` }} />
                  </div>
                  <span className="font-mono text-[10.5px] text-ink3 min-w-[44px] text-right">{fmtT(duration)}</span>
                </div>
              </div>

              {has ? (
                <div className="flex flex-col gap-1">
                  <div className="max-h-[132px] overflow-y-auto flex flex-col gap-1">
                    {sorted.map((r, i) => (
                      <div key={r.id} className="flex items-center gap-2.5 px-3 py-1.5 rounded-[7px] bg-sidebar border border-sidebar-border font-mono text-[11.5px]">
                        <span className="w-2 h-2 rounded-full flex-none" style={{ background: color(i) }} />
                        <span className="text-sidebar-ink3 min-w-[14px]">#{i + 1}</span>
                        <span style={{ color: color(i) }}>{fmtT(r.start)}</span>
                        <span className="text-sidebar-ink3">→</span>
                        <span style={{ color: color(i) }}>{fmtT(r.end)}</span>
                        <span className="text-sidebar-ink3 text-[10.5px]">{Math.floor((r.end - r.start) / 60)}m {Math.floor((r.end - r.start) % 60)}s</span>
                        <div className="flex-1" />
                        <button type="button" title="Remove" onClick={() => setRegions((p) => p.filter((x) => x.id !== r.id))} className="p-0.5 text-sidebar-ink3 hover:text-sidebar-ink"><Icon name="x" size={12} color="currentColor" /></button>
                      </div>
                    ))}
                  </div>
                  <div className="font-mono text-[10.5px] text-ink3 text-right pr-1">Keep total: {Math.floor(totalSel / 60)}m {Math.floor(totalSel % 60)}s</div>
                </div>
              ) : (
                <div className="px-3.5 py-2.5 rounded-lg bg-sidebar border border-sidebar-border text-[12.5px] text-sidebar-ink3 italic">Drag on the waveform to select regions to keep. You can add multiple.</div>
              )}

              <div className="flex gap-2 justify-end">
                {has && (
                  <button type="button" onClick={() => setRegions([])} className="h-[34px] px-3.5 rounded-lg bg-transparent border border-border text-ink3 text-[13px] hover:border-ink3">Clear all</button>
                )}
                <button type="button" onClick={save} disabled={!has || saving}
                  className={`h-[34px] px-5 rounded-lg text-[13px] font-500 ${has && !saving ? 'bg-accent text-on-accent' : 'bg-border text-ink3 cursor-not-allowed'}`}>
                  {saving ? 'Saving…' : `Save${regions.length > 1 ? ` ${regions.length} regions` : ' trimmed'}`}
                </button>
              </div>
            </>
          )}
      </div>
    </div>
  );
}
