import {
  ARENA_H, ARENA_W,
  FIRE_COOLDOWN_TICKS, HISTORY_TICKS, INPUT_FIRE, MAX_REWIND_MS, PLAYER_MAX_HEALTH,
  PLAYER_MAX_STAMINA, PLAYER_RADIUS, RESPAWN_TICKS, SHOT_DAMAGE, SHOT_RADIUS, TICK_DT,
  firstWallDistance, makeShotRay, rayCircleDistance, samplePositions, stepPlayer,
  type ClientInput, type GameEvent, type PlayerState, type Pos, type ServerSnapshot, type TimelineEntry,
} from "@netcode/shared";
import { serverNow } from "./time";

export interface GameOptions {
  lagComp: boolean;        // Phase 5 compensation ON/OFF (the experiment variable)
  now?: () => number;      // injectable clock so tests are deterministic
}

interface ClockInfo {
  offset: number | null;   // serverTime ~= clientTime + offset (as reported by the client)
  rtt: number | null;
}

// Deterministic spawns (Phase 9 needs reproducibility, so no Math.random here).
const SPAWNS: Pos[] = [
  { x: 180, y: 220 },
  { x: ARENA_W - 180, y: 220 },
  { x: 180, y: ARENA_H - 220 },
  { x: ARENA_W - 180, y: ARENA_H - 220 },
];

export class Game {
  readonly lagComp: boolean;
  tick = 0;

  private now: () => number;
  private tickTime: number;
  private players = new Map<number, PlayerState>();
  private inputQueues = new Map<number, ClientInput[]>();
  private clocks = new Map<number, ClockInfo>();
  private lastFireTick = new Map<number, number>();
  private history: TimelineEntry[] = []; // Phase 5 ring buffer: one entry per tick
  private events: GameEvent[] = [];
  private nextId = 1;

  constructor(opts: GameOptions) {
    this.lagComp = opts.lagComp;
    this.now = opts.now ?? serverNow;
    this.tickTime = this.now();
  }

  addPlayer(): number {
    const id = this.nextId++;
    const spawn = SPAWNS[(id - 1) % SPAWNS.length]!;
    const aimX = id % 2 === 1 ? 1 : -1;
    this.players.set(id, {
      id,
      x: spawn.x,
      y: spawn.y,
      vx: 0,
      vy: 0,
      aimX,
      aimY: 0,
      health: PLAYER_MAX_HEALTH,
      stamina: PLAYER_MAX_STAMINA,
      alive: true,
      respawnTicks: 0,
      score: 0,
      lastProcessedInputSeq: 0,
    });
    this.inputQueues.set(id, []);
    this.clocks.set(id, { offset: null, rtt: null });
    this.events.push({ kind: "join", id });
    return id;
  }

  removePlayer(id: number) {
    this.players.delete(id);
    this.inputQueues.delete(id);
    this.clocks.delete(id);
    this.lastFireTick.delete(id);
    this.events.push({ kind: "leave", id });
  }

  // Phase 2 -> 5: the client's own offset/RTT estimate, piggy-backed on pings.
  setClock(id: number, offset: number, rtt: number) {
    if (this.clocks.has(id)) this.clocks.set(id, { offset, rtt });
  }

  getClock(id: number): ClockInfo | undefined {
    return this.clocks.get(id);
  }

  queueInput(id: number, raw: ClientInput) {
    const q = this.inputQueues.get(id);
    const p = this.players.get(id);
    if (!q || !p) return;
    if (!Number.isFinite(raw.seq) || !Number.isFinite(raw.clientTime)) return;
    if (raw.seq <= p.lastProcessedInputSeq) return; // stale/duplicate
    const lastQueued = q[q.length - 1];
    if (lastQueued && raw.seq <= lastQueued.seq) return; // duplicate/out-of-order

    const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
    const input: ClientInput = {
      t: "input",
      seq: raw.seq,
      clientTime: raw.clientTime,
      dx: num(raw.dx),
      dy: num(raw.dy),
      aimX: num(raw.aimX),
      aimY: num(raw.aimY),
      inputBits: num(raw.inputBits) | 0,
      viewDelay: Math.min(MAX_REWIND_MS, Math.max(0, num(raw.viewDelay))),
    };
    if (q.length < 120) q.push(input); // cap so a flood can't grow memory
  }

  // Advance exactly one fixed timestep.
  update() {
    this.tick++;
    this.tickTime = this.now();

    for (const [id, q] of this.inputQueues) {
      let p = this.players.get(id)!;
      if (!p.alive) {
        for (const input of q) p.lastProcessedInputSeq = input.seq;
        q.length = 0;
        p = this.tickRespawn(p);
      } else if (q.length === 0) {
        p = { ...p, vx: 0, vy: 0 }; // no input this tick: stand still
      } else {
        for (const input of q) {
          p = stepPlayer(p, input, TICK_DT);
          p.lastProcessedInputSeq = input.seq;
          // The attacker's position HERE equals what the client predicted at this input,
          // because inputs are applied in order with the same sim. Only the TARGET is rewound.
          if (input.inputBits & INPUT_FIRE) this.tryShot(p, input);
        }
        q.length = 0;
      }
      this.players.set(id, p);
    }

    this.recordHistory();
  }

  private tickRespawn(p: PlayerState): PlayerState {
    const respawnTicks = Math.max(0, p.respawnTicks - 1);
    if (respawnTicks > 0) return { ...p, respawnTicks, vx: 0, vy: 0 };

    const spawn = SPAWNS[(p.id - 1) % SPAWNS.length]!;
    const alive = {
      ...p,
      x: spawn.x,
      y: spawn.y,
      vx: 0,
      vy: 0,
      health: PLAYER_MAX_HEALTH,
      stamina: PLAYER_MAX_STAMINA,
      alive: true,
      respawnTicks: 0,
    };
    this.events.push({ kind: "respawn", id: p.id, x: spawn.x, y: spawn.y, tick: this.tick });
    return alive;
  }

  private recordHistory() {
    this.history.push({
      time: this.tickTime,
      players: [...this.players.values()].map(({ id, x, y }) => ({ id, x, y })),
    });
    if (this.history.length > HISTORY_TICKS) this.history.shift();
  }

  // ---- Phase 5+: lag-compensated hitscan shot ----
  private tryShot(attacker: PlayerState, input: ClientInput) {
    const last = this.lastFireTick.get(attacker.id) ?? -Infinity;
    if (this.tick - last < FIRE_COOLDOWN_TICKS) return;
    this.lastFireTick.set(attacker.id, this.tick);

    // What the world looks like RIGHT NOW (used when compensation is off, and for the hitNow metric).
    const nowTarget = this.findShotTarget(attacker, (o) => o);

    // What the attacker was actually looking at when they pressed the key.
    let rewindMs = 0;
    let rewound: Map<number, Pos> | null = null;
    const offset = this.clocks.get(attacker.id)?.offset;
    if (this.lagComp && offset != null && this.history.length > 0) {
      const serverTimeAtInput = input.clientTime + offset;
      const target = Math.min(
        this.tickTime,
        Math.max(this.tickTime - MAX_REWIND_MS, serverTimeAtInput - input.viewDelay),
      );
      rewindMs = this.tickTime - target;
      rewound = samplePositions(this.history, target);
    }

    const shotTarget = rewound ? this.findShotTarget(attacker, (o) => rewound!.get(o.id) ?? o) : nowTarget;
    const hit = shotTarget.targetId !== null;
    const targetId = shotTarget.targetId;
    let killed = false;

    if (hit && targetId !== null) {
      const target = this.players.get(targetId);
      if (target && target.alive) {
        const health = Math.max(0, target.health - SHOT_DAMAGE);
        killed = health <= 0;
        this.players.set(targetId, {
          ...target,
          health,
          alive: !killed,
          respawnTicks: killed ? RESPAWN_TICKS : 0,
          vx: killed ? 0 : target.vx,
          vy: killed ? 0 : target.vy,
        });

        if (killed) {
          attacker.score += 1;
        }
      }
    }

    this.events.push({
      kind: "shot",
      attacker: attacker.id,
      target: targetId,
      hit,
      hitNow: nowTarget.targetId !== null,
      damage: hit ? SHOT_DAMAGE : 0,
      killed,
      blockedByWall: shotTarget.blockedByWall,
      fromX: attacker.x,
      fromY: attacker.y,
      toX: shotTarget.endX,
      toY: shotTarget.endY,
      tick: this.tick,
      rewindMs,
      compensated: rewound !== null,
    });
  }

  private findShotTarget(attacker: PlayerState, posOf: (p: PlayerState) => Pos) {
    const ray = makeShotRay(attacker.x, attacker.y, attacker.aimX, attacker.aimY);
    const wallDist = firstWallDistance(ray);
    const maxDist = wallDist ?? ray.range;
    let targetId: number | null = null;
    let bestDist = maxDist;

    for (const other of this.players.values()) {
      if (other.id === attacker.id) continue;
      if (!other.alive) continue;
      const pos = posOf(other);
      const d = rayCircleDistance(ray, { id: other.id, x: pos.x, y: pos.y, radius: SHOT_RADIUS });
      if (d !== null && d <= bestDist) {
        bestDist = d;
        targetId = other.id;
      }
    }

    const endDist = targetId === null ? maxDist : bestDist;
    return {
      targetId,
      blockedByWall: targetId === null && wallDist !== null,
      endX: ray.x + ray.dx * endDist,
      endY: ray.y + ray.dy * endDist,
    };
  }

  snapshot(): ServerSnapshot {
    const snap: ServerSnapshot = {
      t: "snapshot",
      tick: this.tick,
      serverTime: this.tickTime, // same timestamp as the history entry for this tick
      players: [...this.players.values()].map(({
        id, x, y, vx, vy, aimX, aimY, health, stamina, alive, respawnTicks, score, lastProcessedInputSeq,
      }) => ({
        id, x, y, vx, vy, aimX, aimY, health, stamina, alive, respawnTicks, score, lastProcessedInputSeq,
      })),
      events: this.events,
    };
    this.events = [];
    return snap;
  }
}
