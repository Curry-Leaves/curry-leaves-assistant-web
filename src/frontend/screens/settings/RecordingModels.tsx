import { useEffect, useState } from 'react';
import { api } from '../../api/client';
import { Icon } from '../../components/chrome/Icon';
import type { WhisperModelInfo, LearnedTerm } from '../../types';
import { SHeader, SGroup, SField, SSelect, STextarea } from './primitives';

// ─── recording: model download + pick + language ─────────────────────────────
export function RecordingModels() {
  const [models, setModels] = useState<WhisperModelInfo[]>([]);
  const [language, setLanguage] = useState('en');
  const [languages, setLanguages] = useState<{ code: string; label: string }[]>([]);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [vocabulary, setVocabulary] = useState('');
  const [vocabSaved, setVocabSaved] = useState(true);
  const [learned, setLearned] = useState<LearnedTerm[]>([]);
  const [minCount, setMinCount] = useState(2);

  const load = () => api.listModels().then((r) => {
    setModels(r.models); setLanguage(r.language); setLanguages(r.languages); setVocabulary(r.vocabulary);
    setLearned(r.learnedVocabulary || []); setMinCount(r.learnedMinCount ?? 2);
  }).catch(() => {});
  useEffect(() => { load(); }, []);

  const toggleTerm = (t: LearnedTerm) => api.blockLearnedTerm(t.term, !t.blocked)
    .then((r) => setLearned(r.learnedVocabulary)).catch(() => {});
  const clearLearned = () => {
    if (!confirm('Forget every learned term? Your own vocabulary list above is untouched.')) return;
    api.clearLearnedVocabulary().then((r) => setLearned(r.learnedVocabulary)).catch(() => {});
  };

  const use = (m: WhisperModelInfo) => api.selectModel({ backend: m.backend, model: m.name }).then((r) => setModels(r.models)).catch(() => {});
  const setLang = (code: string) => { setLanguage(code); api.selectModel({ language: code }).catch(() => {}); };
  const saveVocabulary = () => { api.selectModel({ vocabulary }).then(() => setVocabSaved(true)).catch(() => {}); };
  const download = async (m: WhisperModelInfo) => {
    const key = `${m.backend}/${m.name}`;
    setDownloading(key);
    try { const r = await api.downloadModel(m.name, m.backend); setModels(r.models); } catch { /* noop */ }
    setDownloading(null);
  };

  const BACKENDS: { id: string; label: string; hint: string }[] = [
    { id: 'mlx-whisper', label: 'MLX Whisper', hint: 'Apple-Silicon accelerated. Recommended on Mac.' },
    { id: 'faster-whisper', label: 'faster-whisper', hint: 'CTranslate2 CPU (int8). Cross-platform fallback.' },
  ];

  return (
    <>
      <SHeader title="Recording" subtitle="Transcription model and language. Models download into ~/.curry-leaves/models." />
      <div className="overflow-y-auto">
        <SGroup title="Language">
          <SField label="Spoken language" hint="Lock Whisper to one language for accuracy. Auto-detect can drift (e.g. to Arabic) on silence.">
            <SSelect value={language} onChange={setLang} title="Language"
              options={languages.map((l) => ({ value: l.code, label: l.label }))} />
          </SField>
          <SField label="Vocabulary" hint="Names, jargon, and acronyms Whisper mishears — one per line or comma-separated. Fed to the model as a recognition hint before every transcription.">
            <STextarea
              value={vocabulary}
              onChange={(v) => { setVocabulary(v); setVocabSaved(false); }}
              onBlur={saveVocabulary}
              placeholder="e.g. Ilayanambi, curry-leaves, mlx-whisper, faster-whisper"
              rows={3}
              minHeight={60}
              saved={vocabSaved}
            />
          </SField>
          <LearnedVocabulary terms={learned} minCount={minCount} onToggle={toggleTerm} onClear={clearLearned} />
        </SGroup>
        {BACKENDS.map((b) => {
          const list = models.filter((m) => m.backend === b.id);
          if (!list.length) return null;
          return (
            <SGroup key={b.id} title={b.label}>
              <div className="text-[11.5px] text-ink3 -mt-1 mb-2">{b.hint}</div>
              {list.map((m) => {
                const key = `${m.backend}/${m.name}`;
                return (
                  <div key={key} className="flex items-center justify-between p-3 rounded-[10px] border border-border bg-card mb-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-[13.5px] text-ink font-550">{m.name}</span>
                        {m.active && <span className="text-[10px] font-600 text-white bg-accent px-1.5 py-0.5 rounded-full">active</span>}
                      </div>
                      <div className="text-[11.5px] text-ink3 font-mono">{m.sizeLabel}{m.downloaded ? ' · downloaded' : ''}</div>
                    </div>
                    <div className="flex items-center gap-2 flex-none">
                      {!m.downloaded && (
                        <button type="button" onClick={() => download(m)} disabled={downloading === key}
                          className="text-[12px] px-2.5 py-1.5 rounded-[6px] border border-border text-ink2 hover:border-ink3 disabled:opacity-50">
                          {downloading === key ? 'Downloading…' : 'Download'}
                        </button>
                      )}
                      {m.downloaded && !m.active && (
                        <button type="button" onClick={() => use(m)}
                          className="text-[12px] px-2.5 py-1.5 rounded-[6px] bg-accent-soft text-accent-ink hover:bg-accent-soft/70">
                          Use
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </SGroup>
          );
        })}
      </div>
    </>
  );
}

/** Terms mined from the user's own meeting notes, shown separately from the hand-typed
 *  list — these were learned, not chosen, so they need to be inspectable and removable.
 *  Active ones bias transcription now; below-threshold ones are shown greyed so the
 *  "seen twice" rule is visible rather than mysterious. */
function LearnedVocabulary({ terms, minCount, onToggle, onClear }: {
  terms: LearnedTerm[];
  minCount: number;
  onToggle: (t: LearnedTerm) => void;
  onClear: () => void;
}) {
  const [showAll, setShowAll] = useState(false);
  if (!terms.length) {
    return (
      <SField label="Learned from your notes" hint="Names and jargon you type into meeting notes are picked up automatically and used to sharpen future transcripts. Nothing learned yet.">
        <div className="text-[12px] text-ink3 italic">Type a name into a meeting note — it'll show up here.</div>
      </SField>
    );
  }
  const active = terms.filter((t) => t.active);
  const pending = terms.filter((t) => !t.active && !t.blocked);
  const blocked = terms.filter((t) => t.blocked);
  const shown = showAll ? terms : [...active, ...pending].slice(0, 24);

  return (
    <SField
      label="Learned from your notes"
      hint={`Names and jargon you type into meeting notes, used to sharpen future transcripts. A term applies once it's appeared in ${minCount} different recordings. Click one to remove it.`}
    >
      <div className="flex flex-wrap gap-1.5">
        {shown.map((t) => (
          <button
            key={t.term}
            type="button"
            onClick={() => onToggle(t)}
            title={t.blocked
              ? 'Removed — click to use it again'
              : t.active
                ? `Seen in ${t.count} recordings · click to remove`
                : `Seen in ${t.count} of ${minCount} recordings needed — not applied yet`}
            className={`group inline-flex items-center gap-1.5 pl-2.5 pr-2 py-1 rounded-full border text-[12px] transition-colors ${
              t.blocked
                ? 'border-border bg-transparent text-ink3 line-through hover:border-ink3'
                : t.active
                  ? 'border-transparent bg-accent-soft text-accent-ink hover:border-accent'
                  : 'border-border border-dashed bg-transparent text-ink3 hover:border-ink3'
            }`}
          >
            <span>{t.term}</span>
            <span className="font-mono text-[10px] opacity-60">{t.count}</span>
            <span className={t.blocked ? 'opacity-60' : 'opacity-0 group-hover:opacity-70'}>
              <Icon name={t.blocked ? 'refresh' : 'x'} size={10} />
            </span>
          </button>
        ))}
      </div>
      <div className="flex items-center gap-3 mt-2 text-[11.5px] text-ink3">
        <span>
          {active.length} applied
          {pending.length > 0 && ` · ${pending.length} pending`}
          {blocked.length > 0 && ` · ${blocked.length} removed`}
        </span>
        {terms.length > shown.length && (
          <button type="button" onClick={() => setShowAll(true)} className="hover:text-ink2 underline underline-offset-2">
            Show all {terms.length}
          </button>
        )}
        {showAll && (
          <button type="button" onClick={() => setShowAll(false)} className="hover:text-ink2 underline underline-offset-2">
            Show less
          </button>
        )}
        <button type="button" onClick={onClear} className="ml-auto hover:text-rec underline underline-offset-2">
          Forget all
        </button>
      </div>
    </SField>
  );
}
