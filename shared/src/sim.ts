import { ARENA_H, ARENA_W, PLAYER_RADIUS, PLAYER_SPEED } from "./constants";

export interface PlayerState {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  lastProcessedInputSeq: number;
}

export interface MoveInput {
  dx: number;
  dy: number;
}

// PURE: no Date.now(), no randomness, no I/O.
// Client prediction (Phase 3) and the server must produce identical results.
export function stepPlayer(p: PlayerState, input: MoveInput, dt: number): PlayerState {
  let dx = Math.max(-1, Math.min(1, input.dx));
  let dy = Math.max(-1, Math.min(1, input.dy));
  const len = Math.hypot(dx, dy);
  if (len > 1) {
    dx /= len;
    dy /= len;
  }
  const vx = dx * PLAYER_SPEED;
  const vy = dy * PLAYER_SPEED;
  const x = Math.max(PLAYER_RADIUS, Math.min(ARENA_W - PLAYER_RADIUS, p.x + vx * dt));
  const y = Math.max(PLAYER_RADIUS, Math.min(ARENA_H - PLAYER_RADIUS, p.y + vy * dt));
  return { ...p, x, y, vx, vy };
}