import { useEffect, useState } from 'react';
import { Icon } from '../../components/chrome/Icon';
import { api } from '../../api/client';
import { SHeader, SGroup, SField, SToggle, Value } from './primitives';
import { AiProviders } from './Providers';
import { ThemePicker } from './ThemePicker';
import { RecordingModels } from './RecordingModels';
import { WakeWord } from './WakeWord';
import { Knowledge } from './Knowledge';
import { Identity } from './Identity';
import { MeetingTemplates } from './MeetingTemplates';
import { Backup } from './Backup';
import { KeyboardShortcuts } from './KeyboardShortcuts';
import { ensureNotificationPermission, notificationState, type NotifyPermission } from '../../notify';
import { useVerboseChat } from '../../prefs';

// ─── section registry ─────────────────────────────────────────────────────────
// Semantic memory (the user profile + per-agent notes) lives in the sidebar's brain
// flyout as "Semantic" — a sibling of Knowledge and Skills — not here in Settings.
// Sections are grouped by what a user is trying to *do*, not by subsystem. Two former
// sections are gone rather than moved:
//   • "Backend"/"About" held five near-static fields between them (version, data dir,
//     service URL) and duplicated each other — they're now one "System" group in General.
//   • "Agents" was a bare enable/disable list duplicating the toggle already on each
//     assistant's profile (AgentForm) and the enabled/disabled filter in AgentsScreen.
//     Assistant management lives in the Assistants tab; Settings no longer mirrors it.
type SectionId = 'general' | 'identity' | 'shortcuts' | 'ai' | 'recording' | 'wakeword' | 'knowledge' | 'templates' | 'backup';
const SECTIONS: { id: SectionId; label: string; icon: string; group: string }[] = [
  { id: 'general', label: 'General', icon: 'settings', group: 'App' },
  { id: 'identity', label: 'Identity', icon: 'user', group: 'App' },
  { id: 'shortcuts', label: 'Keyboard shortcuts', icon: 'keyboard', group: 'App' },
  { id: 'recording', label: 'Recording', icon: 'mic', group: 'Capture' },
  { id: 'wakeword', label: 'Wake word', icon: 'headphones', group: 'Capture' },
  { id: 'templates', label: 'Meeting templates', icon: 'chat', group: 'Capture' },
  { id: 'knowledge', label: 'Knowledge', icon: 'library', group: 'System' },
  { id: 'ai', label: 'AI providers', icon: 'sparkle', group: 'System' },
  { id: 'backup', label: 'Backup & data', icon: 'download', group: 'System' },
];

// Sections that no longer exist but may still be deep-linked (a stale caller, a
// remembered ⌘K entry). Map them somewhere sensible instead of silently ignoring.
const SECTION_ALIASES: Record<string, SectionId> = {
  backend: 'general',
  about: 'general',
  agents: 'general',
};

// ─── screen ───────────────────────────────────────────────────────────────────
export function SettingsScreen({ initialSection, onSectionHandled }: {
  initialSection?: string | null;
  onSectionHandled?: () => void;
}) {
  const [section, setSection] = useState<SectionId>('general');
  const [base, setBase] = useState('');
  useEffect(() => { api.baseUrl().then(setBase).catch(() => {}); }, []);
  const [version, setVersion] = useState('');
  useEffect(() => { window.curryLeaves?.getAppVersion().then(setVersion).catch(() => {}); }, []);
  // The real path from the backend, rather than three hardcoded "~/.curry-leaves"
  // strings that would all lie under a custom CURRY_LEAVES_DIR.
  const [dataDir, setDataDir] = useState('');
  useEffect(() => { api.backupInfo().then((i) => setDataDir(i.dataDir)).catch(() => {}); }, []);

  // Deep-link support: a caller (e.g. Capture's "model not ready" banner) can jump
  // straight to a section; clear the request once consumed so returning here later
  // doesn't override the user's own navigation.
  useEffect(() => {
    if (!initialSection) return;
    const target = SECTIONS.some((s) => s.id === initialSection)
      ? (initialSection as SectionId)
      : SECTION_ALIASES[initialSection];
    if (target) setSection(target);
    onSectionHandled?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialSection]);

  const groups: Record<string, typeof SECTIONS> = {};
  for (const s of SECTIONS) (groups[s.group] ||= []).push(s);

  return (
    <div className="flex-1 flex min-h-0 min-w-0">
      {/* section nav */}
      <div className="w-[220px] flex-none bg-bg border-r border-border overflow-y-auto py-4">
        <div className="px-5 pb-2 font-serif text-[16px] text-ink">Settings</div>
        {Object.entries(groups).map(([grp, items]) => (
          <div key={grp} className="mb-2">
            <div className="px-5 pt-2.5 pb-1 text-[10px] font-600 tracking-wider uppercase text-ink3">{grp}</div>
            {items.map((s) => {
              const active = section === s.id;
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setSection(s.id)}
                  className={`w-[calc(100%-16px)] mx-2 flex items-center gap-2.5 h-[30px] px-2.5 rounded-[7px] text-[13px] ${
                    active ? 'bg-border text-ink font-550' : 'text-ink2 hover:bg-border-soft'
                  }`}
                >
                  <span className={active ? 'text-accent' : 'text-ink3'}><Icon name={s.icon} size={14} /></span>
                  {s.label}
                </button>
              );
            })}
          </div>
        ))}
      </div>

      {/* content */}
      <div className="flex-1 flex flex-col min-w-0 bg-bg">
        {section === 'general' && (
          <>
            <SHeader title="General" subtitle="Appearance, notifications, and where this install keeps its files." />
            <div className="overflow-y-auto">
              <SGroup title="Appearance">
                <div className="text-[13px] font-550 text-ink">Theme</div>
                <div className="text-[11.5px] text-ink3 leading-relaxed">Applies instantly and is remembered. ‘System’ follows your OS light/dark setting.</div>
                <ThemePicker />
              </SGroup>
              <SGroup title="Chat">
                <SField label="Verbose activity" hint="Show each tool call and the nested subagent tree in a chat turn. Off (default): show just the assistant's thinking as it streams, then its reply.">
                  <VerboseChatControl />
                </SField>
              </SGroup>
              <SGroup title="Notifications">
                <SField label="Desktop notifications" hint="Alerts when an assistant needs your answer, a reminder is due, or a dashboard tile raises an alert.">
                  <NotificationControl />
                </SField>
              </SGroup>
              {/* Absorbed from the former Backend + About sections, which between them held
                  five near-static fields and listed the version and data dir twice. */}
              <SGroup title="System">
                <SField label="Version"><Value mono>{version || '…'}</Value></SField>
                <SField label="Engine" hint="Agents & chat run on smart-loop; transcription on faster-whisper.">
                  <Value>smart-loop · faster-whisper</Value>
                </SField>
                <SField label="Data directory" hint="Everything you own — settings, assistants, recordings, notes, events — lives here as plain files.">
                  <Value mono>{dataDir || '~/.curry-leaves'}</Value>
                </SField>
                <SField label="Service URL" hint="The local Python service powering recordings, assistants, and chat. Auto-assigned on launch.">
                  <Value mono>{base || '…'}</Value>
                </SField>
              </SGroup>
            </div>
          </>
        )}

        {section === 'identity' && <Identity />}

        {section === 'shortcuts' && <KeyboardShortcuts />}

        {section === 'ai' && <AiProviders />}

        {section === 'recording' && <RecordingModels />}
        {section === 'wakeword' && <WakeWord />}
        {section === 'knowledge' && <Knowledge />}

        {section === 'templates' && <MeetingTemplates />}

        {section === 'backup' && <Backup />}
      </div>
    </div>
  );
}

// ─── verbose chat toggle (General → Chat) ────────────────────────────────────────
function VerboseChatControl() {
  const [verbose, setVerbose] = useVerboseChat();
  return <SToggle value={verbose} onChange={setVerbose} />;
}

// ─── notification permission control (General → Notifications) ───────────────────
function NotificationControl() {
  const [state, setState] = useState<NotifyPermission>(() => notificationState());
  // Re-read on focus — the user may change it in the browser's site settings.
  useEffect(() => {
    const onFocus = () => setState(notificationState());
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, []);

  const enable = async () => setState(await ensureNotificationPermission());

  if (state === 'native') return <Value>On — native notifications</Value>;
  if (state === 'unsupported') return <Value>Not supported in this browser</Value>;
  if (state === 'granted') {
    return <span className="text-[12.5px] text-ok font-550 inline-flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full bg-ok" /> Enabled</span>;
  }
  if (state === 'denied') {
    return (
      <div className="text-[12px] text-ink3 leading-relaxed max-w-[380px]">
        Blocked. Allow notifications for this site in your browser’s address-bar site
        settings, then reload — the app can’t re-prompt once you’ve blocked it.
      </div>
    );
  }
  // 'default' — never asked (or dismissed). A real click can prompt.
  return (
    <button type="button" onClick={enable}
      className="px-3.5 py-1.5 rounded-[8px] bg-accent text-white text-[12.5px] font-550">
      Enable notifications
    </button>
  );
}
