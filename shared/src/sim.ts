import {
  INPUT_SPRINT,
  PLAYER_MAX_HEALTH,
  PLAYER_MAX_STAMINA,
  PLAYER_RADIUS,
  PLAYER_SPEED,
  SPRINT_MULTIPLIER,
  STAMINA_DRAIN_PER_SEC,
  STAMINA_REGEN_PER_SEC,
} from "./constants";
import { normalizeAim } from "./combat";
import { resolveCircleWalls } from "./world";

export interface PlayerState {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  aimX: number;
  aimY: number;
  health: number;
  stamina: number;
  alive: boolean;
  respawnTicks: number;
  score: number;
  lastProcessedInputSeq: number;
}

export interface MoveInput {
  dx: number;
  dy: number;
  aimX?: number;
  aimY?: number;
  inputBits?: number;
}

// PURE: no Date.now(), no randomness, no I/O.
// Client prediction (Phase 3) and the server must produce identical results.
export function stepPlayer(p: PlayerState, input: MoveInput, dt: number): PlayerState {
  const aim = normalizeAim(input.aimX ?? p.aimX, input.aimY ?? p.aimY, p.aimX, p.aimY);

  if (!p.alive) {
    return { ...p, vx: 0, vy: 0, aimX: aim.aimX, aimY: aim.aimY };
  }

  let dx = Math.max(-1, Math.min(1, input.dx));
  let dy = Math.max(-1, Math.min(1, input.dy));
  const len = Math.hypot(dx, dy);
  if (len > 1) {
    dx /= len;
    dy /= len;
  }

  const wantsSprint = (input.inputBits ?? 0) & INPUT_SPRINT;
  const moving = len > 0.0001;
  const canSprint = Boolean(wantsSprint && moving && p.stamina > 1);
  const speed = PLAYER_SPEED * (canSprint ? SPRINT_MULTIPLIER : 1);
  const vx = dx * speed;
  const vy = dy * speed;
  const stamina = Math.max(
    0,
    Math.min(
      PLAYER_MAX_STAMINA,
      p.stamina + (canSprint ? -STAMINA_DRAIN_PER_SEC : STAMINA_REGEN_PER_SEC) * dt,
    ),
  );
  const pos = resolveCircleWalls(p.x + vx * dt, p.y + vy * dt, PLAYER_RADIUS);

  return {
    ...p,
    x: pos.x,
    y: pos.y,
    vx,
    vy,
    aimX: aim.aimX,
    aimY: aim.aimY,
    health: Math.max(0, Math.min(PLAYER_MAX_HEALTH, p.health)),
    stamina,
  };
}
