import { Globe } from 'lucide-react';
import { FallingLeaves } from './FallingLeaves';
import appLogo from '../assets/icons/icon.png';

/**
 * The branded left pane shared by every pre-app screen — the connection gate, the
 * first-run setup wizard, and the PIN lock. Ambient aura + drifting leaves behind a
 * mascot, name and tagline, with the author credit pinned to the bottom.
 *
 * `children` renders under the tagline: the gate puts its status line there, the
 * wizard its step list. Nothing renders there on the lock screen.
 *
 * Text uses the brand-ink/* ladder, NOT ink/* or sidebar-ink/*. This pane sits on
 * --color-sidebar, which is a light cream in most themes but a dark emerald in `default`
 * — so neither of the existing ladders is legible on both (ink/* is near-black text,
 * sidebar-ink/* is white). brand-ink/* defaults to ink/* and inverts per-theme; see
 * index.css.
 */
export function BrandPane({ children, compact }: { children?: React.ReactNode; compact?: boolean }) {
  return (
    <div className="relative overflow-hidden bg-sidebar border-r border-sidebar-border flex flex-col items-center justify-center px-10">
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="lp-aura absolute -top-[20%] -left-[10%] w-[55vw] h-[55vw] rounded-full blur-[90px] opacity-50"
             style={{ background: 'radial-gradient(circle, var(--color-login-aura) 0%, transparent 65%)' }} />
        <div className="lp-aura2 absolute -bottom-[25%] -right-[10%] w-[60vw] h-[60vw] rounded-full blur-[100px] opacity-40"
             style={{ background: 'radial-gradient(circle, var(--color-login-aura-2) 0%, transparent 65%)' }} />
        <FallingLeaves />
      </div>

      <div className="absolute bottom-6 inset-x-0 z-10 flex flex-col items-center gap-2">
        <p className="text-[10.5px] text-brand-ink3 tracking-wide">
          Crafted by <span className="font-medium text-brand-ink2">Ilayanambi Ponramu (Nambi)</span>
        </p>
        <div className="flex items-center gap-3">
          <a href="https://www.linkedin.com/in/ilayanambi-ponramu-467b7b110" target="_blank" rel="noopener noreferrer"
             aria-label="LinkedIn" title="LinkedIn"
             className="text-brand-ink3 hover:text-brand-ink transition-colors">
            <svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor" aria-hidden="true">
              <path d="M20.45 20.45h-3.55v-5.57c0-1.33-.02-3.03-1.85-3.03-1.85 0-2.14 1.45-2.14 2.94v5.66H9.36V9h3.41v1.56h.05c.47-.9 1.63-1.85 3.36-1.85 3.6 0 4.27 2.37 4.27 5.45v6.29zM5.34 7.43a2.06 2.06 0 1 1 0-4.12 2.06 2.06 0 0 1 0 4.12zM7.12 20.45H3.56V9h3.56v11.45z" />
            </svg>
          </a>
          <a href="https://x.com/ilayanambi" target="_blank" rel="noopener noreferrer"
             aria-label="X (Twitter)" title="X"
             className="text-brand-ink3 hover:text-brand-ink transition-colors">
            <svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor" aria-hidden="true">
              <path d="M18.24 2.25h3.31l-7.23 8.26 8.5 11.24h-6.66l-5.22-6.83-5.97 6.83H1.66l7.73-8.84L1.24 2.25h6.83l4.72 6.24 5.45-6.24zm-1.16 17.52h1.83L7.02 4.13H5.06l12.02 15.64z" />
            </svg>
          </a>
          <a href="https://ilayanambi.com/" target="_blank" rel="noopener noreferrer"
             aria-label="Personal website" title="ilayanambi.com"
             className="text-brand-ink3 hover:text-brand-ink transition-colors">
            <Globe size={15} strokeWidth={1.75} />
          </a>
        </div>
      </div>

      <div className="an-rise relative z-10 flex flex-col items-center text-center max-w-full px-4">
        <div className="relative mb-6 grid place-items-center">
          <span className="lp-ring absolute w-28 h-28 rounded-full border border-sidebar-border" />
          <span className="absolute w-24 h-24 rounded-full blur-2xl opacity-40"
                style={{ background: 'var(--color-sidebar-border)' }} />
          <img src={appLogo} alt="Curry Leaves" draggable={false}
               className="an-breathe relative w-[104px] h-[104px] object-contain drop-shadow-lg" />
        </div>
        <h2 className="text-[26px] font-serif font-semibold tracking-tight text-brand-ink">Curry Leaves</h2>
        <p className="text-[12.5px] text-brand-ink3 font-medium tracking-wide mt-1">Your quiet second brain, and assistant.</p>
        <span className="mt-3 w-10 h-px bg-sidebar-border" />
        {/* The full tagline is two long unwrapped lines — too wide for the wizard's
            narrower pane, so `compact` drops it in favour of the step list. */}
        {!compact && (
          <>
            <p className="text-[16px] font-serif italic text-brand-ink3 leading-relaxed mt-4 whitespace-nowrap">
              Never the star of the dish, yet nothing tastes right without it.
            </p>
            <p className="text-[13.5px] text-brand-ink3 leading-relaxed mt-2 tracking-wide whitespace-nowrap">
              The best assistants work the same way —
              <span className="text-brand-ink2 not-italic font-medium"> unseen, essential, never in your way</span>.
            </p>
          </>
        )}
        {children}
      </div>
    </div>
  );
}
