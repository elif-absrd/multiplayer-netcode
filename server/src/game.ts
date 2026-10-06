import {
  ARENA_H, ARENA_W,
  HISTORY_TICKS, INPUT_TAG, MAX_REWIND_MS, TAG_COOLDOWN_TICKS, TAG_RANGE, TICK_DT,
  samplePositions, stepPlayer,
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
  { x: ARENA_W * 0.25, y: ARENA_H * 0.5 },
  { x: ARENA_W * 0.75, y: ARENA_H * 0.5 },
  { x: ARENA_W * 0.25, y: ARENA_H * 0.25 },
  { x: ARENA_W * 0.75, y: ARENA_H * 0.75 },
];

export class Game {
  readonly lagComp: boolean;
  tick = 0;

  private now: () => number;
  private tickTime: number;
  private players = new Map<number, PlayerState>();
  private inputQueues = new Map<number, ClientInput[]>();
  private clocks = new Map<number, ClockInfo>();
  private lastTagTick = new Map<number, number>();
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
    this.players.set(id, { id, x: spawn.x, y: spawn.y, vx: 0, vy: 0, lastProcessedInputSeq: 0 });
    this.inputQueues.set(id, []);
    this.clocks.set(id, { offset: null, rtt: null });
    this.events.push({ kind: "join", id });
    return id;
  }

  removePlayer(id: number) {
    this.players.delete(id);
    this.inputQueues.delete(id);
    this.clocks.delete(id);
    this.lastTagTick.delete(id);
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
      if (q.length === 0) {
        p = { ...p, vx: 0, vy: 0 }; // no input this tick: stand still
      } else {
        for (const input of q) {
          p = stepPlayer(p, input, TICK_DT);
          p.lastProcessedInputSeq = input.seq;
          // The attacker's position HERE equals what the client predicted at this input,
          // because inputs are applied in order with the same sim. Only the TARGET is rewound.
          if (input.inputBits & INPUT_TAG) this.tryTag(p, input);
        }
        q.length = 0;
      }
      this.players.set(id, p);
    }

    this.recordHistory();
  }

  private recordHistory() {
    this.history.push({
      time: this.tickTime,
      players: [...this.players.values()].map(({ id, x, y }) => ({ id, x, y })),
    });
    if (this.history.length > HISTORY_TICKS) this.history.shift();
  }

  // ---- Phase 5: lag-compensated tag ----
  private tryTag(attacker: PlayerState, input: ClientInput) {
    const last = this.lastTagTick.get(attacker.id) ?? -Infinity;
    if (this.tick - last < TAG_COOLDOWN_TICKS) return;
    this.lastTagTick.set(attacker.id, this.tick);

    // What the world looks like RIGHT NOW (used when compensation is off, and for the hitNow metric).
    const nowId = this.findTarget(attacker, (o) => o);

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

    const targetId = rewound ? this.findTarget(attacker, (o) => rewound!.get(o.id) ?? o) : nowId;

    this.events.push({
      kind: "tag",
      attacker: attacker.id,
      target: targetId,
      hit: targetId !== null,
      hitNow: nowId !== null,
      tick: this.tick,
      rewindMs,
      compensated: rewound !== null,
    });
    // Phase 6 will apply the consequence (score / "it" swap) here, using CURRENT state.
  }

  private findTarget(attacker: PlayerState, posOf: (p: PlayerState) => Pos): number | null {
    let best: number | null = null;
    let bestDist = TAG_RANGE;
    for (const other of this.players.values()) {
      if (other.id === attacker.id) continue;
      const pos = posOf(other);
      const d = Math.hypot(pos.x - attacker.x, pos.y - attacker.y);
      if (d <= bestDist) {
        bestDist = d;
        best = other.id;
      }
    }
    return best;
  }

  snapshot(): ServerSnapshot {
    const snap: ServerSnapshot = {
      t: "snapshot",
      tick: this.tick,
      serverTime: this.tickTime, // same timestamp as the history entry for this tick
      players: [...this.players.values()].map(({ id, x, y, vx, vy, lastProcessedInputSeq }) => ({
        id, x, y, vx, vy, lastProcessedInputSeq,
      })),
      events: this.events,
    };
    this.events = [];
    return snap;
  }
}