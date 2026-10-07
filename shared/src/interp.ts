// Used by the CLIENT (Phase 4 interpolation) and the SERVER (Phase 5 history rewind).
// Same function on both sides => what the client saw is what the server reconstructs.

export interface Pos {
  x: number;
  y: number;
}

export interface TimelinePlayer extends Pos {
  id: number;
}

export interface TimelineEntry {
  time: number; // server time (ms) this state was valid
  players: ReadonlyArray<TimelinePlayer>;
}

// entries must be sorted by time ascending. Clamps outside the range (no extrapolation).
export function samplePositions(entries: ReadonlyArray<TimelineEntry>, t: number): Map<number, Pos> {
  const out = new Map<number, Pos>();
  const n = entries.length;
  if (n === 0) return out;

  const first = entries[0]!;
  const last = entries[n - 1]!;
  const fill = (e: TimelineEntry) => {
    for (const p of e.players) out.set(p.id, { x: p.x, y: p.y });
  };

  if (n === 1 || t <= first.time) {
    fill(first);
    return out;
  }
  if (t >= last.time) {
    fill(last);
    return out;
  }

  let i = n - 2;
  while (i > 0 && entries[i]!.time > t) i--;
  const a = entries[i]!;
  const b = entries[i + 1]!;
  const span = b.time - a.time;
  const alpha = span > 0 ? (t - a.time) / span : 1;

  const prev = new Map<number, TimelinePlayer>();
  for (const p of a.players) prev.set(p.id, p);
  for (const p of b.players) {
    const q = prev.get(p.id);
    out.set(p.id, q ? { x: q.x + (p.x - q.x) * alpha, y: q.y + (p.y - q.y) * alpha } : { x: p.x, y: p.y });
  }
  return out;
}