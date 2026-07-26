import { type Change } from 'diff';
import type { Hunk } from './types';

// ─── Diff helpers ─────────────────────────────────────────────────────────────
export function buildHunks(parts: Change[]): Hunk[] {
  const hunks: Hunk[] = [];
  let i = 0;
  while (i < parts.length) {
    const p = parts[i];
    if (!p.added && !p.removed) { i++; continue; }
    let j = i;
    let removed = '';
    let added = '';
    while (j < parts.length && (parts[j].added || parts[j].removed)) {
      if (parts[j].removed) removed += parts[j].value;
      if (parts[j].added) added += parts[j].value;
      j++;
    }
    hunks.push({ id: `h-${i}-${j}`, partStart: i, partEnd: j - 1, removed, added, state: 'pending' });
    i = j;
  }
  return hunks;
}

export function mergeHunks(parts: Change[], hunks: Hunk[]): string {
  const byStart = new Map(hunks.map((h) => [h.partStart, h]));
  let out = '';
  let i = 0;
  while (i < parts.length) {
    const h = byStart.get(i);
    if (h) { out += h.state === 'accepted' ? h.added : h.removed; i = h.partEnd + 1; }
    else { out += parts[i].value; i++; }
  }
  return out;
}
