import { Icon } from './chrome/Icon';

// Placeholder for a diagram whose source is still streaming in. Rendering mermaid on a
// half-written `graph TD` would reparse (and mostly fail) on every token, flickering
// between error fallbacks — so we hold this until the fence closes and draw once.
export function DiagramSkeleton({ label = 'Drawing diagram' }: { label?: string }) {
  return (
    <div className="my-2 h-[120px] rounded-[10px] border border-border bg-card flex items-center justify-center gap-2 text-[12px] text-ink3">
      <span className="an-pulse flex items-center gap-2">
        <Icon name="wave" size={13} />
        {label}…
      </span>
    </div>
  );
}
