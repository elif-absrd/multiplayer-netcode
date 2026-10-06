// End-to-end check against a RUNNING server (fresh start recommended):
//   terminal 1: pnpm dev:server      terminal 2: pnpm smoke
// Uses Node's built-in global WebSocket (Node 22+), so it needs no dependencies.
import {
  INPUT_TAG, PLAYER_SPEED, SERVER_PORT, TICK_DT, TICK_MS,
  decode, encode,
  type ClientMessage, type GameEvent, type PlayerSnap, type ServerMessage, type ServerSnapshot,
} from "../shared/src/index";

declare const process: { exitCode?: number };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name} ${detail}`);
  if (!ok) failures++;
}

class Bot {
  ws = new WebSocket(`ws://localhost:${SERVER_PORT}`);
  id = 0;
  seq = 0;
  latest: ServerSnapshot | null = null;
  snapshots = 0;
  pongs = 0;
  offset = 0;
  rtt = 0;
  tags: Extract<GameEvent, { kind: "tag" }>[] = [];

  constructor() {
    this.ws.addEventListener("message", (e) => {
      const m = decode<ServerMessage>(String(e.data));
      if (!m) return;
      if (m.t === "welcome") this.id = m.id;
      else if (m.t === "pong") {
        const t3 = performance.now();
        this.pongs++;
        this.rtt = t3 - m.clientTime;
        this.offset = m.serverTime - (m.clientTime + t3) / 2;
      } else if (m.t === "snapshot") {
        this.latest = m;
        this.snapshots++;
        for (const ev of m.events) if (ev.kind === "tag" && ev.attacker === this.id) this.tags.push(ev);
      }
    });
  }
  open() {
    return new Promise<void>((res) => this.ws.addEventListener("open", () => res()));
  }
  send(m: ClientMessage) {
    this.ws.send(encode(m));
  }
  ping() {
    this.send({ t: "ping", clientTime: performance.now(), ...(this.pongs ? { offset: this.offset, rtt: this.rtt } : {}) });
  }
  input(dx: number, dy: number, inputBits = 0) {
    this.send({ t: "input", seq: ++this.seq, clientTime: performance.now(), dx, dy, inputBits, viewDelay: this.rtt / 2 });
  }
  me(): PlayerSnap {
    return this.latest!.players.find((p) => p.id === this.id)!;
  }
}

const a = new Bot();
const b = new Bot();
await Promise.all([a.open(), b.open()]);
await sleep(300);
check("both players got distinct ids", a.id > 0 && b.id > 0 && a.id !== b.id, `(${a.id}, ${b.id})`);

// Phase 2: clock sync (two rounds so the second one carries a report)
a.ping(); await sleep(100); a.ping(); await sleep(150);
check("pong received", a.pongs >= 2, `(rtt ${a.rtt.toFixed(1)} ms, offset ${a.offset.toFixed(1)})`);

// Phase 1: tick rate
const s0 = a.snapshots;
await sleep(1000);
const rate = a.snapshots - s0;
check("snapshot rate ~30 Hz", rate >= 24 && rate <= 36, `(${rate}/s)`);

// Phase 3 groundwork: server acks inputs and moves exactly one step per input
const x0 = a.me().x;
for (let i = 0; i < 10; i++) { a.input(1, 0); await sleep(TICK_MS); }
await sleep(150);
const expected = 10 * PLAYER_SPEED * TICK_DT;
check("all 10 inputs acked", a.me().lastProcessedInputSeq === a.seq, `(${a.me().lastProcessedInputSeq}/${a.seq})`);
check("moved exactly 10 steps", Math.abs(a.me().x - x0 - expected) < 1, `(${(a.me().x - x0).toFixed(1)} vs ${expected.toFixed(1)})`);

// Phase 5: chase B and tag it
const deadline = Date.now() + 10000;
while (Date.now() < deadline && a.tags.length === 0) {
  const me = a.me();
  const them = a.latest!.players.find((p) => p.id === b.id)!;
  const dist = Math.hypot(them.x - me.x, them.y - me.y);
  if (dist < 30) a.input(0, 0, INPUT_TAG);
  else a.input((them.x - me.x) / dist, (them.y - me.y) / dist);
  await sleep(TICK_MS);
}
check("tag event produced and hit", a.tags.length > 0 && a.tags[0]!.hit, a.tags[0] ? `(compensated=${a.tags[0].compensated}, rewind ${a.tags[0].rewindMs.toFixed(0)} ms)` : "");

// cooldown: three more tag inputs right away must not create more attempts
const before = a.tags.length;
for (let i = 0; i < 3; i++) { a.input(0, 0, INPUT_TAG); await sleep(TICK_MS); }
await sleep(100);
check("tag cooldown enforced", a.tags.length === before, `(${a.tags.length} attempts)`);

a.ws.close(); b.ws.close();
console.log(failures ? `\n${failures} check(s) FAILED` : "\nall checks passed");
process.exitCode = failures ? 1 : 0;