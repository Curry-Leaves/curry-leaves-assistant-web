import { useCallback, useState } from 'react';
import { Icon } from '../../components/chrome/Icon';
import { api } from '../../api/client';

// Electron's BrowserWindow doesn't implement window.prompt()/confirm() (they
// silently return null/false) — every create/delete flow needs its own modal.
export function PromptModal({ title, label, placeholder, onClose, onSubmit }: {
  title: string; label: string; placeholder?: string; onClose: () => void; onSubmit: (value: string) => void;
}) {
  const [value, setValue] = useState('');
  const submit = () => { if (value.trim()) { onSubmit(value.trim()); onClose(); } };
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/25" onClick={onClose}>
      <div className="w-[420px] max-w-[92vw] bg-card border border-border rounded-[12px] shadow-pop flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}>
        <div className="px-4 py-2.5 border-b border-border flex items-center gap-2">
          <span className="text-[13px] font-550 text-ink">{title}</span>
          <span className="flex-1" />
          <button type="button" onClick={onClose} title="Close" className="w-6 h-6 grid place-items-center rounded-[6px] text-ink3 hover:text-ink hover:bg-border-soft">
            <Icon name="x" size={13} />
          </button>
        </div>
        <div className="p-4 flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <label className="text-[10.5px] font-600 uppercase tracking-wider text-ink3">{label}</label>
            <input value={value} onChange={(e) => setValue(e.target.value)} placeholder={placeholder} autoFocus
              onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
              className="px-2.5 py-1.5 rounded-[7px] border border-border bg-bg text-[12.5px] text-ink outline-none focus:border-accent" />
          </div>
          <button type="button" onClick={submit} disabled={!value.trim()}
            className="self-end px-3 py-1.5 rounded-[7px] bg-accent text-on-accent text-[12px] font-550 hover:opacity-90 disabled:opacity-50">
            Create
          </button>
        </div>
      </div>
    </div>
  );
}

export function ConfirmModal({ title, message, onCancel, onConfirm }: {
  title: string; message: string; onCancel: () => void; onConfirm: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/25" onClick={onCancel}>
      <div className="w-[420px] max-w-[92vw] bg-card border border-border rounded-[12px] shadow-pop flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}>
        <div className="px-4 py-2.5 border-b border-border flex items-center gap-2">
          <Icon name="warning" size={14} color="var(--color-rec)" />
          <span className="text-[13px] font-550 text-ink">{title}</span>
        </div>
        <div className="p-4 flex flex-col gap-3">
          <div className="text-[12.5px] text-ink2 leading-relaxed">{message}</div>
          <div className="self-end flex items-center gap-2">
            <button type="button" onClick={onCancel}
              className="px-3 py-1.5 rounded-[7px] border border-border text-ink2 text-[12px] hover:border-ink3">
              Cancel
            </button>
            <button type="button" onClick={onConfirm}
              className="px-3 py-1.5 rounded-[7px] bg-rec text-white text-[12px] font-550 hover:opacity-90">
              Delete
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function NewSkillModal({ onClose, onCreated }: { onClose: () => void; onCreated: (name: string) => void }) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [body, setBody] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const create = useCallback(async () => {
    if (!name.trim()) { setError('Name is required.'); return; }
    setSaving(true); setError(null);
    try {
      await api.createSkill(name.trim(), description.trim(), body);
      onCreated(name.trim());
      onClose();
    } catch (e) { setError(String(e)); } finally { setSaving(false); }
  }, [name, description, body, onCreated, onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/25" onClick={onClose}>
      <div className="w-[480px] max-w-[92vw] bg-card border border-border rounded-[12px] shadow-pop flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}>
        <div className="px-4 py-2.5 border-b border-border flex items-center gap-2">
          <Icon name="steps" size={14} />
          <span className="text-[13px] font-550 text-ink">New skill</span>
          <span className="flex-1" />
          <button type="button" onClick={onClose} title="Close" className="w-6 h-6 grid place-items-center rounded-[6px] text-ink3 hover:text-ink hover:bg-border-soft">
            <Icon name="x" size={13} />
          </button>
        </div>
        <div className="p-4 flex flex-col gap-3">
          {error && <div className="text-[11.5px] text-rec">{error}</div>}
          <div className="flex flex-col gap-1">
            <label className="text-[10.5px] font-600 uppercase tracking-wider text-ink3">Name (kebab-case)</label>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="my-new-skill" autoFocus
              className="px-2.5 py-1.5 rounded-[7px] border border-border bg-bg text-[12.5px] text-ink outline-none focus:border-accent" />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[10.5px] font-600 uppercase tracking-wider text-ink3">Description</label>
            <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="One line — when to use this skill"
              className="px-2.5 py-1.5 rounded-[7px] border border-border bg-bg text-[12.5px] text-ink outline-none focus:border-accent" />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[10.5px] font-600 uppercase tracking-wider text-ink3">SKILL.md body</label>
            <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={8} spellCheck={false}
              placeholder="# procedure&#10;&#10;Steps go here…"
              className="px-2.5 py-1.5 rounded-[7px] border border-border bg-bg text-[12px] font-mono text-ink outline-none focus:border-accent resize-none" />
          </div>
          <button type="button" onClick={create} disabled={saving}
            className="self-end px-3 py-1.5 rounded-[7px] bg-accent text-on-accent text-[12px] font-550 hover:opacity-90 disabled:opacity-50">
            {saving ? 'Creating…' : 'Create skill'}
          </button>
        </div>
      </div>
    </div>
  );
}
