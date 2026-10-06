import test from "node:test";
import assert from "node:assert/strict";
import { INPUT_TAG, TICK_MS, type ClientInput, type GameEvent } from "@netcode/shared";
import { Game } from "../src/game";

// Fake clock: advances exactly one tick per update so timestamps are exact.
function setup(lagComp: boolean) {
  let t = 1_000_000;
  const game = new Game({ lagComp, now: () => t });
  const a = game.addPlayer(); // spawns left  (200,300)
  const b = game.addPlayer(); // spawns right (600,300)
  game.setClock(a, 0, 0);     // client clock == server clock, so clientTime is a server time
  game.setClock(b, 0, 0);
  const seq = { [a]: 0, [b]: 0 } as Record<number, number>;

  const input = (id: number, dx: number, dy: number, bits = 0, clientTime = t): ClientInput => ({
    t: "input", seq: ++seq[id]!, clientTime, dx, dy, inputBits: bits, viewDelay: 0,
  });
  const tick = () => { t += TICK_MS; game.update(); };
  return { game, a, b, input, tick, time: () => t };
}

// Walk toward each other for 25 ticks: gap closes to ~33px (< TAG_RANGE 48).
function approach(s: ReturnType<typeof setup>) {
  for (let i = 0; i < 25; i++) {
    s.game.queueInput(s.a, s.input(s.a, 1, 0));
    s.game.queueInput(s.b, s.input(s.b, -1, 0));
    s.tick();
  }
  return s.time(); // the moment B was close
}

// B then dodges upward for 6 ticks (~44px): now ~55px away (> TAG_RANGE).
function dodge(s: ReturnType<typeof setup>) {
  for (let i = 0; i < 6; i++) {
    s.game.queueInput(s.b, s.input(s.b, 0, -1));
    s.tick();
  }
}

const tagEvents = (events: GameEvent[]) => events.filter((e) => e.kind === "tag");

test("compensation ON: a tag aimed at where B WAS still hits after B dodged", () => {
  const s = setup(true);
  const tNear = approach(s);
  dodge(s);
  s.game.snapshot(); // flush events
  // A fired at the moment B was close (clientTime = tNear), but the server only gets it now.
  s.game.queueInput(s.a, s.input(s.a, 0, 0, INPUT_TAG, tNear));
  s.tick();
  const [ev] = tagEvents(s.game.snapshot().events);
  assert.ok(ev && ev.kind === "tag");
  assert.equal(ev.compensated, true);
  assert.equal(ev.hit, true);
  assert.equal(ev.hitNow, false); // would have missed against current positions
  assert.ok(ev.rewindMs > 0);
});

test("compensation OFF: the same tag misses", () => {
  const s = setup(false);
  const tNear = approach(s);
  dodge(s);
  s.game.snapshot();
  s.game.queueInput(s.a, s.input(s.a, 0, 0, INPUT_TAG, tNear));
  s.tick();
  const [ev] = tagEvents(s.game.snapshot().events);
  assert.ok(ev && ev.kind === "tag");
  assert.equal(ev.compensated, false);
  assert.equal(ev.hit, false);
  assert.equal(ev.rewindMs, 0);
});

test("tag cooldown: holding the key only produces one attempt per cooldown window", () => {
  const s = setup(true);
  approach(s);
  s.game.snapshot();
  for (let i = 0; i < 5; i++) {
    s.game.queueInput(s.a, s.input(s.a, 0, 0, INPUT_TAG));
    s.tick();
  }
  assert.equal(tagEvents(s.game.snapshot().events).length, 1);
});

test("inputs are acked in order and stale/duplicate seqs are dropped", () => {
  const s = setup(true);
  const first = s.input(s.a, 1, 0);
  s.game.queueInput(s.a, first);
  s.game.queueInput(s.a, first); // duplicate while still queued: dropped
  s.tick();
  s.game.queueInput(s.a, first); // now stale (seq <= lastProcessed)
  s.tick();
  const me = s.game.snapshot().players.find((p) => p.id === s.a)!;
  assert.equal(me.lastProcessedInputSeq, 1);
});