import { Icon } from '../../components/chrome/Icon';

/** The Memory tab's opening screen — shown until a note or skill is picked.
 *
 *  Deliberately NOT the shared TabPlaceholder: this pane is the one place a user meets a
 *  filing model that is otherwise invisible (facts live under whatever they're ABOUT; the
 *  assistants write it, you don't have to). A three-line tip list can't carry that, and
 *  widening TabPlaceholder for one caller would drag every recording tab along with it.
 *
 *  Everything here is stated the way the system actually behaves — the areas are the real
 *  `AREAS` taxonomy from domain/memory.py, and the "assistants file it for you" flow is the
 *  primary path (kb_write / the filer), with manual pages as the exception rather than the
 *  headline. Nothing promises a capability the app doesn't have.
 */

// The browsable folder taxonomy, mirroring AREAS in domain/memory.py. `memory` is omitted
// on purpose: those notes (profile, episodes, private agent memory) are found by `type:`,
// are written by the assistants, and aren't something a user files into by hand.
const AREAS: { name: string; icon: string; blurb: string }[] = [
  { name: 'people', icon: 'user', blurb: 'Someone you work with — and the facts you’ve shared about them.' },
  { name: 'apps', icon: 'grid', blurb: 'A product or system: what it is, how it’s built, decisions made.' },
  { name: 'topics', icon: 'brain', blurb: 'A subject you keep returning to.' },
  { name: 'meetings', icon: 'mic', blurb: 'Filed from a recording, linked back to its transcript.' },
  { name: 'notes', icon: 'file', blurb: 'Anything that doesn’t belong to the above.' },
];

const STEPS: { icon: string; title: string; body: string }[] = [
  {
    icon: 'chat',
    title: 'Just talk — it files itself',
    body: 'Tell an assistant to “remember” something in Ask AI. It decides where the note belongs, links it to what it relates to, and updates an existing note instead of making a duplicate.',
  },
  {
    icon: 'mic',
    title: 'Meetings land here on their own',
    body: 'Record a conversation and the filer pulls out what’s worth keeping. Each note keeps a link back to the transcript it came from.',
  },
  {
    icon: 'download',
    title: 'Paste or upload what you already have',
    body: '“Feed docs” in the top bar takes pasted text — notes, a spec, an email thread — or an uploaded file. Either way the durable facts are extracted and filed the same way.',
  },
];

export function MemoryWelcome({ onNewNote, onIngest }: {
  onNewNote: () => void;
  onIngest: () => void;
}) {
  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-[620px] mx-auto px-8 py-10 an-rise">
        <span className="text-ink3"><Icon name="library" size={24} /></span>
        <h2 className="font-serif italic text-[20px] text-ink2 mt-3">Everything your assistants know</h2>
        <p className="text-[12.5px] text-ink3 mt-2 leading-relaxed">
          Facts, decisions, people and past conversations — kept as plain markdown you can read,
          edit and move. Your assistants write here as you talk to them, and read from it before
          they answer, so you only have to say something once.
        </p>

        {/* How it fills up — the primary path first; manual creation is the exception. */}
        <div className="mt-7 flex flex-col gap-3.5">
          {STEPS.map((s) => (
            <div key={s.title} className="flex gap-2.5">
              <span className="flex-none mt-0.5 text-accent"><Icon name={s.icon} size={14} /></span>
              <div className="min-w-0">
                <div className="text-[12.5px] font-550 text-ink">{s.title}</div>
                <div className="text-[11.5px] text-ink3 leading-relaxed mt-0.5">{s.body}</div>
              </div>
            </div>
          ))}
        </div>

        {/* The filing model. Worth naming explicitly: it's the part users otherwise have to
            reverse-engineer from the tree. */}
        <div className="mt-8 pt-6 border-t border-border-soft">
          <div className="text-[12.5px] font-550 text-ink">How it&rsquo;s organised</div>
          <p className="text-[11.5px] text-ink3 mt-1 leading-relaxed">
            Notes are filed under whatever they&rsquo;re <em>about</em>, not by when they arrived.
            A fact about a colleague lives on that person&rsquo;s page; a decision about a project
            lives on the project&rsquo;s.
          </p>
          <div className="mt-3.5 flex flex-col gap-2">
            {AREAS.map((a) => (
              <div key={a.name} className="flex items-baseline gap-2.5">
                <span className="flex-none w-[76px] flex items-center gap-1.5 font-mono text-[11px] text-ink2">
                  <span className="flex-none text-ink3"><Icon name={a.icon} size={11} /></span>
                  {a.name}
                </span>
                <span className="text-[11.5px] text-ink3 leading-snug">{a.blurb}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Skills sit in the same rail and are a different kind of thing — say so, briefly. */}
        <div className="mt-7 pt-6 border-t border-border-soft">
          <div className="flex items-baseline gap-2">
            <span className="flex-none text-ink3 translate-y-0.5"><Icon name="steps" size={13} /></span>
            <div className="min-w-0">
              <div className="text-[12.5px] font-550 text-ink">Skills are further down the rail</div>
              <p className="text-[11.5px] text-ink3 mt-1 leading-relaxed">
                Knowledge is what your assistants <em>know</em>; a Skill is a procedure they
                <em> follow</em> — how to run a meeting digest, how to build a deck. Some are built
                in, and assistants write new ones as they learn what works.
              </p>
            </div>
          </div>
        </div>

        <div className="mt-8 flex items-center gap-2">
          <button type="button" onClick={onNewNote}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-[7px] bg-accent text-on-accent text-[12px] font-550 hover:opacity-90">
            <Icon name="plus" size={13} />Write a page
          </button>
          <button type="button" onClick={onIngest}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-[7px] border border-border text-ink2 text-[12px] font-550 hover:border-ink3">
            <Icon name="download" size={13} />Feed docs
          </button>
        </div>
        <p className="text-[11px] text-faint mt-3 leading-relaxed">
          Most of this fills in on its own — writing a page by hand is the exception, not the
          starting point.
        </p>
      </div>
    </div>
  );
}
