import { ARENA_H, ARENA_W } from "./constants";

export interface Wall {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export const WALLS: readonly Wall[] = [
  { id: "north-left", x: 118, y: 116, w: 236, h: 34 },
  { id: "north-right", x: 606, y: 116, w: 236, h: 34 },
  { id: "mid-left", x: 228, y: 264, w: 72, h: 132 },
  { id: "mid-right", x: 660, y: 244, w: 72, h: 132 },
  { id: "center", x: 424, y: 292, w: 112, h: 58 },
  { id: "south-left", x: 118, y: 490, w: 236, h: 34 },
  { id: "south-right", x: 606, y: 490, w: 236, h: 34 },
] as const;

export function clampToArena(x: number, y: number, radius: number) {
  return {
    x: Math.max(radius, Math.min(ARENA_W - radius, x)),
    y: Math.max(radius, Math.min(ARENA_H - radius, y)),
  };
}

export function resolveCircleWalls(x: number, y: number, radius: number) {
  let px = x;
  let py = y;

  for (const wall of WALLS) {
    const nearestX = Math.max(wall.x, Math.min(wall.x + wall.w, px));
    const nearestY = Math.max(wall.y, Math.min(wall.y + wall.h, py));
    const dx = px - nearestX;
    const dy = py - nearestY;
    const dist = Math.hypot(dx, dy);

    if (dist >= radius) continue;

    if (dist > 0.0001) {
      const push = radius - dist;
      px += (dx / dist) * push;
      py += (dy / dist) * push;
      continue;
    }

    const left = Math.abs(px - wall.x);
    const right = Math.abs(wall.x + wall.w - px);
    const top = Math.abs(py - wall.y);
    const bottom = Math.abs(wall.y + wall.h - py);
    const min = Math.min(left, right, top, bottom);

    if (min === left) px = wall.x - radius;
    else if (min === right) px = wall.x + wall.w + radius;
    else if (min === top) py = wall.y - radius;
    else py = wall.y + wall.h + radius;
  }

  return clampToArena(px, py, radius);
}
