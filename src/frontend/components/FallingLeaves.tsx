// A dozen curry-leaf glyphs drifting down at staggered speeds/delays/drift,
// each on its own CSS animation so nothing needs a render loop. Purely
// decorative — aria-hidden, no pointer events. Absolutely positioned to fill
// its nearest positioned ancestor, so the parent needs `relative overflow-hidden`.
const LEAVES = Array.from({ length: 12 }, (_, i) => ({
  left: (i * 8.7 + 3) % 100,
  delay: (i * 1.37) % 9,
  duration: 9 + (i % 5) * 2.2,
  size: 14 + (i % 4) * 5,
  drift: (i % 2 === 0 ? 1 : -1) * (20 + (i % 3) * 12),
  spin: (i % 2 === 0 ? 1 : -1) * (180 + (i % 4) * 90),
  opacity: 0.35 + (i % 3) * 0.12,
}));

export function FallingLeaves() {
  return (
    <div aria-hidden className="absolute inset-0 pointer-events-none overflow-hidden">
      {LEAVES.map((leaf, i) => (
        <span
          key={i}
          className="lp-leaf absolute top-[-40px]"
          style={{
            left: `${leaf.left}%`,
            width: leaf.size,
            height: leaf.size,
            opacity: leaf.opacity,
            animationDelay: `${leaf.delay}s`,
            animationDuration: `${leaf.duration}s`,
            ['--leaf-drift' as string]: `${leaf.drift}px`,
            ['--leaf-spin' as string]: `${leaf.spin}deg`,
          }}
        >
          <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-full h-full">
            <path
              d="M20 4C10 4 4 10 4 20c10 0 16-6 16-16Z"
              fill="var(--color-accent)"
            />
            <path d="M20 4C13 8 8 13 4 20" stroke="var(--color-accent-dark)" strokeWidth="0.8" strokeLinecap="round" />
          </svg>
        </span>
      ))}
    </div>
  );
}
