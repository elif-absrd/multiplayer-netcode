import "./style.css";

import {
  INTERP_DELAY_MS,
  TICK_MS,
  type ClientInput,
  type ServerSnapshot,
} from "@netcode/shared";

import { config } from "./config";
import { Clock, startClockSync } from "./clock";
import { Net } from "./net";
import { readInput } from "./input";
import { Predictor } from "./prediction";
import { RemoteView } from "./interpolation";
import { render, type Drawn } from "./render";

const clock = new Clock();
const predictor = new Predictor();
const remoteView = new RemoteView();

let myId: number | null = null;
let lagComp: boolean | null = null;
let latest: ServerSnapshot | null = null;

let seq = 0;
let lastTag = "-";

let gameStarted = false;
let paused = false;

const flashUntil = new Map<number, number>();
const recentCorrections: number[] = [];

predictor.onCorrection = (mag) => {
  recentCorrections.push(mag);

  if (recentCorrections.length > 60) {
    recentCorrections.shift();
  }
};

// --------------------------------------------------
// DOM
// --------------------------------------------------

const app = document.getElementById("app")!;

app.innerHTML = `
  <div id="start-screen" class="screen">
    <div class="menu-panel start-panel">

      <div class="eyebrow">REAL-TIME NETWORKING EXPERIMENT</div>

      <h1>TAG PROTOCOL</h1>

      <p class="subtitle">
        Two-player multiplayer under unreliable network conditions
      </p>

      <div class="info-grid">

        <section class="menu-section">
          <h2>CONTROLS</h2>

          <div class="control-row">
            <span class="key-group">
              <kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd>
            </span>
            <span>Move</span>
          </div>

          <div class="control-row">
            <span class="key-group">
              <kbd>↑</kbd><kbd>←</kbd><kbd>↓</kbd><kbd>→</kbd>
            </span>
            <span>Move</span>
          </div>

          <div class="control-row">
            <span><kbd>SPACE</kbd></span>
            <span>Tag opponent</span>
          </div>

          <div class="control-row">
            <span><kbd>P</kbd></span>
            <span>Toggle prediction</span>
          </div>

          <div class="control-row">
            <span><kbd>I</kbd></span>
            <span>Toggle interpolation</span>
          </div>

          <div class="control-row">
            <span><kbd>ESC</kbd></span>
            <span>Pause</span>
          </div>
        </section>

        <section class="menu-section">
          <h2>NETWORKING</h2>

          <div class="feature-row">
            <span class="dot green"></span>
            <span>Client-side prediction</span>
          </div>

          <div class="feature-row">
            <span class="dot purple"></span>
            <span>Remote interpolation</span>
          </div>

          <div class="feature-row">
            <span class="dot amber"></span>
            <span>Server lag compensation</span>
          </div>

          <div class="player-legend">
            <div>
              <span class="player-dot you"></span>
              You
            </div>

            <div>
              <span class="player-dot opponent"></span>
              Opponent
            </div>
          </div>
        </section>

      </div>

      <button id="start-button" class="primary-button">
        START GAME
      </button>

      <div class="start-status">
        Waiting for connection...
      </div>

    </div>
  </div>

  <div id="game-screen" class="game-screen hidden">

    <div id="game-area">
      <canvas id="game" width="800" height="600"></canvas>
    </div>

    <button id="pause-button" class="pause-button" aria-label="Pause">
      II
    </button>

  </div>

  </div>

  <div id="pause-overlay" class="screen hidden">

    <div class="menu-panel pause-panel">

      <div class="eyebrow">GAME PAUSED</div>

      <h1>PAUSED</h1>

      <button id="resume-button" class="primary-button">
        RESUME GAME
      </button>

      <div class="pause-info-grid">

        <section class="menu-section">
          <h2>CONTROLS</h2>

          <div class="control-row">
            <span>
              <kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd>
            </span>
            <span>Move</span>
          </div>

          <div class="control-row">
            <span>
              <kbd>↑</kbd><kbd>←</kbd><kbd>↓</kbd><kbd>→</kbd>
            </span>
            <span>Move</span>
          </div>

          <div class="control-row">
            <span><kbd>SPACE</kbd></span>
            <span>Tag</span>
          </div>

          <div class="control-row">
            <span><kbd>P</kbd></span>
            <span>Prediction</span>
          </div>

          <div class="control-row">
            <span><kbd>I</kbd></span>
            <span>Interpolation</span>
          </div>

          <div class="control-row">
            <span><kbd>ESC</kbd></span>
            <span>Resume</span>
          </div>
        </section>

        <section class="menu-section">
          <h2>NETWORK INFO</h2>

          <div class="stat-row">
            <span>Player ID</span>
            <strong id="stat-id">-</strong>
          </div>

          <div class="stat-row">
            <span>Players</span>
            <strong id="stat-players">-</strong>
          </div>

          <div class="stat-row">
            <span>Tick</span>
            <strong id="stat-tick">-</strong>
          </div>

          <div class="stat-row">
            <span>RTT</span>
            <strong id="stat-rtt">-</strong>
          </div>

          <div class="stat-row">
            <span>Jitter</span>
            <strong id="stat-jitter">-</strong>
          </div>

          <div class="stat-row">
            <span>Clock Offset</span>
            <strong id="stat-offset">-</strong>
          </div>

          <div class="stat-row">
            <span>Last Correction</span>
            <strong id="stat-correction">-</strong>
          </div>

          <div class="stat-row">
            <span>Last Tag</span>
            <strong id="stat-tag">-</strong>
          </div>
        </section>

      </div>

      <section class="status-section">

        <h2>NETWORK FEATURES</h2>

        <div class="feature-status">
          <span>Prediction</span>
          <strong id="status-prediction">ON</strong>
        </div>

        <div class="feature-status">
          <span>Interpolation</span>
          <strong id="status-interpolation">ON</strong>
        </div>

        <div class="feature-status">
          <span>Lag Compensation</span>
          <strong id="status-lag-comp">ON</strong>
        </div>

      </section>

      <div class="pause-hint">
        Press <kbd>ESC</kbd> to resume
      </div>

    </div>

  </div>

  <pre id="hud" class="hidden"></pre>
`;

// --------------------------------------------------
// UI elements
// --------------------------------------------------

const startScreen = document.getElementById("start-screen")!;
const gameScreen = document.getElementById("game-screen")!;
const pauseOverlay = document.getElementById("pause-overlay")!;

const startButton = document.getElementById("start-button")!;
const resumeButton = document.getElementById("resume-button")!;
const pauseButton = document.getElementById("pause-button")!;

const startStatus = document.querySelector(".start-status")!;

// --------------------------------------------------
// Stats elements
// --------------------------------------------------

const statId = document.getElementById("stat-id")!;
const statPlayers = document.getElementById("stat-players")!;
const statTick = document.getElementById("stat-tick")!;
const statRtt = document.getElementById("stat-rtt")!;
const statJitter = document.getElementById("stat-jitter")!;
const statOffset = document.getElementById("stat-offset")!;
const statCorrection = document.getElementById("stat-correction")!;
const statTag = document.getElementById("stat-tag")!;

const statusPrediction = document.getElementById("status-prediction")!;
const statusInterpolation = document.getElementById("status-interpolation")!;
const statusLagComp = document.getElementById("status-lag-comp")!;

// --------------------------------------------------
// Helpers
// --------------------------------------------------

function updatePauseStats() {
  statId.textContent = `${myId ?? "-"}`;
  statPlayers.textContent = `${latest?.players.length ?? 0}`;
  statTick.textContent = `${latest?.tick ?? "-"}`;

  statRtt.textContent =
    clock.rtt !== null
      ? `${clock.rtt.toFixed(0)} ms`
      : "-";

  statJitter.textContent =
    `${clock.jitter.toFixed(1)} ms`;

  statOffset.textContent =
    clock.offset !== null
      ? `${clock.offset.toFixed(1)} ms`
      : "-";

  statCorrection.textContent =
    `${predictor.lastCorrection.toFixed(2)} px`;

  statTag.textContent = lastTag;

  statusPrediction.textContent =
    config.prediction ? "ON" : "OFF";

  statusInterpolation.textContent =
    config.interpolation ? "ON" : "OFF";

  statusLagComp.textContent =
    lagComp ? "ON" : "OFF";

  statusPrediction.className =
    config.prediction ? "on" : "off";

  statusInterpolation.className =
    config.interpolation ? "on" : "off";

  statusLagComp.className =
    lagComp ? "on" : "off";
}

function setPaused(value: boolean) {
  paused = value;

  if (paused) {
    pauseOverlay.classList.remove("hidden");
    updatePauseStats();
  } else {
    pauseOverlay.classList.add("hidden");
  }
}

// --------------------------------------------------
// Start game
// --------------------------------------------------

startButton.addEventListener("click", () => {
  gameStarted = true;

  startScreen.classList.add("hidden");
  gameScreen.classList.remove("hidden");

  startStatus.textContent = "";
});

// --------------------------------------------------
// Pause
// --------------------------------------------------

pauseButton.addEventListener("click", () => {
  if (!gameStarted) return;

  setPaused(true);
});

resumeButton.addEventListener("click", () => {
  setPaused(false);
});

window.addEventListener("keydown", (e) => {
  if (e.repeat) return;

  const key = e.key.toLowerCase();

  if (key === "escape" && gameStarted) {
    setPaused(!paused);
    return;
  }

  if (paused) return;

  if (key === "p") {
    config.prediction = !config.prediction;

    if (!config.prediction) {
      predictor.state = null;
    }
  }

  if (key === "i") {
    config.interpolation = !config.interpolation;
  }
});

// --------------------------------------------------
// Networking
// --------------------------------------------------

function viewDelayMs(): number {
  return (
    (clock.rtt ?? 0) / 2 +
    (config.interpolation ? INTERP_DELAY_MS : 0)
  );
}

function onSnapshot(snap: ServerSnapshot) {
  latest = snap;
  remoteView.push(snap);

  if (config.prediction && myId !== null) {
    const own = snap.players.find((p) => p.id === myId);

    if (own) {
      if (predictor.state === null) {
        predictor.state = { ...own };
      } else {
        predictor.reconcile(own);
      }
    }
  }

  for (const ev of snap.events) {
    if (ev.kind !== "tag") continue;

    const verdict = ev.hit ? "HIT" : "MISS";

    const now =
      ev.hit !== ev.hitNow
        ? ` (current: ${ev.hitNow ? "hit" : "miss"})`
        : "";

    const mode = ev.compensated
      ? `rewound ${ev.rewindMs.toFixed(0)}ms`
      : "uncompensated";

    lastTag =
      `${verdict} ${ev.attacker}->${ev.target ?? "-"} ${mode}${now}`;

    if (ev.hit && ev.target !== null) {
      flashUntil.set(
        ev.target,
        performance.now() + 300
      );
    }
  }

  if (paused) {
    updatePauseStats();
  }
}

function sendInput() {
  // Don't send movement while game hasn't started
  // or while paused.
  if (!gameStarted || paused) return;

  const { dx, dy, inputBits } = readInput();

  const input: ClientInput = {
    t: "input",
    seq: ++seq,
    clientTime:
      performance.timeOrigin + performance.now(),
    dx,
    dy,
    inputBits,
    viewDelay: viewDelayMs(),
  };

  if (config.prediction) {
    predictor.applyLocal(input);
  }

  net.send(input);
}

const net = new Net({
  onOpen: () => {
    startClockSync(
      (m) => net.send(m),
      clock
    );

    setInterval(sendInput, TICK_MS);

    startStatus.textContent =
      "Connected • Ready to play";
  },

  onMessage: (m) => {
    if (m.t === "welcome") {
      myId = m.id;
      lagComp = m.lagComp;

      updatePauseStats();
    }

    else if (m.t === "pong") {
      clock.onPong(
        m,
        performance.timeOrigin + performance.now()
      );
    }

    else if (m.t === "snapshot") {
      onSnapshot(m);
    }
  },
});

// --------------------------------------------------
// Rendering
// --------------------------------------------------

function frame() {
  const nowMs = performance.now();
  const serverNow = clock.serverTimeNow();

  const drawn: Drawn[] = [];
  let ghost: Drawn | null = null;

  if (latest) {
    const sampled =
      config.interpolation && serverNow !== null
        ? remoteView.sample(
            serverNow - viewDelayMs()
          )
        : null;

    for (const p of latest.players) {

      if (
        p.id === myId &&
        config.prediction &&
        predictor.state
      ) {
        drawn.push({
          id: p.id,
          x: predictor.state.x,
          y: predictor.state.y,
        });

        ghost = {
          id: p.id,
          x: p.x,
          y: p.y,
        };

        continue;
      }

      const pos = sampled?.get(p.id) ?? p;

      drawn.push({
        id: p.id,
        x: pos.x,
        y: pos.y,
      });
    }
  }

  const flashing = new Set<number>();

  for (const [id, until] of flashUntil) {
    if (until > nowMs) {
      flashing.add(id);
    } else {
      flashUntil.delete(id);
    }
  }

  render(
    drawn,
    myId,
    ghost,
    flashing
  );

  requestAnimationFrame(frame);
}

frame();