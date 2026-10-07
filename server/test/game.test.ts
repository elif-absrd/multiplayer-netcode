import test from "node:test";
import assert from "node:assert/strict";
import { INPUT_FIRE, TICK_MS, type ClientInput, type GameEvent } from "@netcode/shared";
import { Game } from "../src/game";

// Fake clock: advances exactly one tick per update so timestamps are exact.
function setup(lagComp: boolean) {
  let t = 1_000_000;
  const game = new Game({ lagComp, now: () => t });
  const a = game.addPlayer(); // spawns left
  const b = game.addPlayer(); // spawns right
  game.setClock(a, 0, 0);     // client clock == server clock, so clientTime is a server time
  game.setClock(b, 0, 0);
  const seq = { [a]: 0, [b]: 0 } as Record<number, number>;

  const input = (
    id: number,
    dx: number,
    dy: number,
    bits = 0,
    clientTime = t,
    aimX = id === a ? 1 : -1,
    aimY = 0,
  ): ClientInput => ({
    t: "input",
    seq: ++seq[id]!,
    clientTime,
    dx,
    dy,
    aimX,
    aimY,
    inputBits: bits,
    viewDelay: 0,
  });
  const tick = () => { t += TICK_MS; game.update(); };
  return { game, a, b, input, tick, time: () => t };
}

function openLane(s: ReturnType<typeof setup>) {
  s.tick();
  return s.time();
}

function dodgeOffLane(s: ReturnType<typeof setup>) {
  for (let i = 0; i < 5; i++) {
    s.game.queueInput(s.b, s.input(s.b, 0, 1));
    s.tick();
  }
}

const shotEvents = (events: GameEvent[]) => events.filter((e) => e.kind === "shot");

test("compensation ON: a hitscan shot aimed at where B WAS still hits after B dodged", () => {
  const s = setup(true);
  const tOpen = openLane(s);
  dodgeOffLane(s);
  s.game.snapshot(); // flush movement events
  // A fired at the moment B was still on the lane, but the server only receives it now.
  s.game.queueInput(s.a, s.input(s.a, 0, 0, INPUT_FIRE, tOpen, 1, 0));
  s.tick();
  const [ev] = shotEvents(s.game.snapshot().events);
  assert.ok(ev && ev.kind === "shot");
  assert.equal(ev.compensated, true);
  assert.equal(ev.hit, true);
  assert.equal(ev.hitNow, false); // would have missed against current positions
  assert.equal(ev.damage, 25);
  assert.ok(ev.rewindMs > 0);
});

test("compensation OFF: the same delayed shot misses", () => {
  const s = setup(false);
  const tOpen = openLane(s);
  dodgeOffLane(s);
  s.game.snapshot();
  s.game.queueInput(s.a, s.input(s.a, 0, 0, INPUT_FIRE, tOpen, 1, 0));
  s.tick();
  const [ev] = shotEvents(s.game.snapshot().events);
  assert.ok(ev && ev.kind === "shot");
  assert.equal(ev.compensated, false);
  assert.equal(ev.hit, false);
  assert.equal(ev.rewindMs, 0);
});

test("fire cooldown: holding fire only produces one shot per cooldown window", () => {
  const s = setup(true);
  openLane(s);
  s.game.snapshot();
  for (let i = 0; i < 5; i++) {
    s.game.queueInput(s.a, s.input(s.a, 0, 0, INPUT_FIRE, s.time(), 1, 0));
    s.tick();
  }
  assert.equal(shotEvents(s.game.snapshot().events).length, 1);
});

test("four hits kill a player and respawn restores health", () => {
  const s = setup(true);
  openLane(s);
  s.game.snapshot();

  for (let i = 0; i < 4; i++) {
    s.game.queueInput(s.a, s.input(s.a, 0, 0, INPUT_FIRE, s.time(), 1, 0));
    s.tick();
    for (let j = 1; j < 10; j++) s.tick();
  }

  const dead = s.game.snapshot().players.find((p) => p.id === s.b)!;
  assert.equal(dead.alive, false);
  assert.equal(dead.health, 0);

  for (let i = 0; i < 65; i++) s.tick();
  const alive = s.game.snapshot().players.find((p) => p.id === s.b)!;
  assert.equal(alive.alive, true);
  assert.equal(alive.health, 100);
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
