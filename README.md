# Real-Time Multiplayer Networking Under Unreliable Network Conditions

A research-oriented two-player browser game for studying how server-side lag compensation affects hit validation and player fairness under controlled network degradation.

The game is intentionally small. The main contribution is the networking system and the reproducible experimental setup, not the gameplay itself.

## Research Question

> How does server-side lag compensation affect collision accuracy and player fairness in a real-time multiplayer game under controlled network degradation?

The primary experimental comparison is **lag compensation OFF vs ON** while varying network conditions such as latency, jitter, and application-level message loss.

---

## Project Status

| Area | Status |
|---|---|
| Phase 0: Design Lock | ✅ Complete |
| Phase 1: Project Setup | ✅ Complete |
| Phase 1: Coding | ⏳ Not started |
| Phase 2–11 | ⏳ Planned |

The design is locked for implementation. Changes to protocol fields, timestamp semantics, proxy ordering, network configuration, database schema, compensation boundaries, or simulation tick semantics should be treated as explicit design changes.

---

## System Overview

```text
                         WebSocket                 WebSocket
                    ┌────────────────┐        ┌────────────────┐
                    │                │        │                │
                 ┌──▼───┐        ┌──▼────────▼──┐        ┌───▼──┐
                 │Client│        │    Proxy      │        │Server│
                 │  A   │◄──────►│   Node + TS   │◄──────►│Node  │
                 └──────┘        │              │        │ + TS │
                 ┌──────┐        │ relay A/B    │        └──────┘
                 │Client│◄──────►│              │
                 │  B   │        └──────────────┘
                 └──────┘
```

Each client has its own relay pair:

```text
Client A <-> Proxy Relay A <-> Server
Client B <-> Proxy Relay B <-> Server
```

The proxy is an **application-level WebSocket relay**. It receives complete WebSocket messages and can independently delay, jitter, or drop messages in each direction.

---

## Core Design

### Authoritative simulation

The server owns the official game state. It runs the simulation at a fixed **60 Hz** timestep and is responsible for:

- player positions and velocities
- input validation
- arena bounds
- tag results
- simulation tick/state

Clients never submit authoritative positions, velocities, tag results, or tick state.

### Client-side prediction and reconciliation

The local browser predicts its own movement immediately instead of waiting for a server response.

Each input has a sequence number. The client keeps unacknowledged inputs in a buffer. When a server snapshot arrives, the client:

1. resets the local player to the authoritative state,
2. removes acknowledged inputs using `lastProcessedInputSeq`,
3. replays the remaining unacknowledged inputs locally.

### Remote-player interpolation

Prediction and reconciliation apply only to the local player. Remote players are rendered from a snapshot interpolation buffer using an initial **100 ms interpolation delay**.

### Clock synchronization

Clients and the server use separate monotonic clocks. A four-timestamp ping/pong exchange estimates clock offset:

```text
t0 = client sends ping
t1 = server receives ping
t2 = server sends pong
t3 = client receives pong
```

Offset:

```text
offset = ((t1 - t0) + (t2 - t3)) / 2
```

RTT:

```text
RTT = (t3 - t0) - (t2 - t1)
```

Raw `clientTime` is untrusted. For lag compensation, the server uses the estimated server-time equivalent of the input timestamp.

### Server-side lag compensation

The server keeps approximately **1 second of recent authoritative history**.

When a tag input is received, the server:

```text
clientTime
    ↓
clientTime + estimated clock offset
    ↓
estimated server time
    ↓
validate rewind range
    ↓
find bracketing historical snapshots
    ↓
interpolate target position
    ↓
perform hit test
    ↓
resolve action using current authoritative state
```

The simulation is not rolled back. Historical state is used only for hit validation.

An input older than the available history is rejected for lag compensation. A future timestamp is clamped to the current server time.

### Controlled network degradation

The proxy independently controls each direction:

```text
Player A -> Server
Server   -> Player A
Player B -> Server
Server   -> Player B
```

Each direction has its own:

- base delay
- jitter
- loss probability
- random seed
- FIFO forwarding queue

Jitter must not create artificial application-level message reordering. Each direction uses a FIFO send queue.

---

## Technology Stack

| Component | Technology |
|---|---|
| Browser client | TypeScript + HTML5 Canvas |
| Client transport | Native WebSocket API |
| Server | Node.js + TypeScript |
| WebSocket server | `ws` |
| Network proxy | Node.js + TypeScript |
| Message encoding | JSON |
| Experiment storage | SQLite |
| Data analysis | Python + pandas + matplotlib |
| Build tooling | Vite |
| Version control | Git + GitHub |

The current design uses Node.js/TypeScript for the proxy. Rust is not part of the current implementation plan.

---

## Repository Structure

The current repository starts with the client and server components:

```text
multiplayer-netcode/
├── client/
└── server/
```

The authoritative server implementation begins with:

```text
server/
├── protocol.ts
├── game.ts
└── index.ts
```

Additional project components will be introduced as later phases are implemented, including the proxy, SQLite instrumentation, deterministic bots, and the analysis pipeline.

---

## Simulation Constants

The initial values are centralized for reproducibility:

```ts
const TICK_RATE = 60;
const DT = 1 / TICK_RATE;

const ARENA_WIDTH = 1000;
const ARENA_HEIGHT = 600;

const PLAYER_RADIUS = 15;
const MAX_SPEED = 200;       // world units / second
const TAG_RADIUS = 30;

const HISTORY_DURATION_MS = 1000;
const INTERPOLATION_DELAY_MS = 100;
```

The coordinate system uses a top-left origin:

```text
(0,0) ─────────────────────────────► +X
  │
  │
  │
  ▼
 +Y
```

Player positions are continuous and the authoritative server enforces arena bounds.

---

## Network Protocol

All application messages are JSON objects with a `type` discriminator.

### Client input

```ts
type ClientInput = {
  type: "input";
  playerId: string;
  seq: number;
  clientTime: number;
  dx: number;
  dy: number;
  inputBits: number;
};
```

Semantics:

- `seq`: monotonically increasing input sequence number
- `clientTime`: monotonic client timestamp when the input was generated
- `dx`, `dy`: movement direction only
- `inputBits`: discrete action bitmask only

Movement is **not** encoded in `inputBits`.

The first defined action bit is:

```ts
const TAG_PRESSED = 0x1;
```

### Server snapshot

```ts
type ServerSnapshot = {
  type: "snapshot";
  playerId: string;
  tick: number;
  serverTime: number;
  players: {
    id: string;
    x: number;
    y: number;
    vx: number;
    vy: number;
    lastProcessedInputSeq: number;
  }[];
  events: {
    type: "tag";
    attackerId: string;
    targetId: string;
    accepted: boolean;
    targetX: number;
    targetY: number;
  }[];
};
```

### Ping request / response

```ts
type PingRequest = {
  type: "ping";
  playerId: string;
  clientTime: number;
};
```

```ts
type PongResponse = {
  type: "pong";
  playerId: string;
  clientTime: number;
  serverReceiveTime: number;
  serverSendTime: number;
};
```

The exact protocol is defined by the project's protocol specification and should remain aligned with the locked Phase 0 design.

---

## Server Input Rules

The server normalizes movement direction before applying speed:

```ts
const magnitude = Math.sqrt(dx * dx + dy * dy);

let nx = 0;
let ny = 0;

if (magnitude > 0) {
  nx = dx / magnitude;
  ny = dy / magnitude;
}

x += nx * MAX_SPEED * DT;
y += ny * MAX_SPEED * DT;
```

This means inputs such as `(1, 0)` and `(100000, 0)` produce the same maximum movement speed.

The logical server tick order is:

```text
1. Read newly received messages
2. Validate connection/player identity
3. Validate input sequence semantics
4. Apply valid movement input
5. Apply discrete actions
6. Resolve hit-tested actions when applicable
7. Clamp authoritative state to world bounds
8. Record historical state
9. Produce snapshots
10. Broadcast snapshots
```

Movement state is persistent. A delayed or dropped movement message does not automatically stop the server from using the latest valid movement state.

A discrete action such as `TAG_PRESSED` is different: if that message is dropped, the action is lost and is not reconstructed.

---

## Proxy Model

The proxy works at the WebSocket message level rather than manipulating raw TCP packets.

For each direction, a configuration has the form:

```ts
type DirectionConfig = {
  delayMs: number;
  jitterMs: number;
  loss: number;
  seed: number;
};
```

Per-player configuration:

```ts
type PlayerNetworkConfig = {
  toServer: DirectionConfig;
  toClient: DirectionConfig;
};
```

Overall configuration:

```ts
type ProxyConfig = {
  players: Record<string, PlayerNetworkConfig>;
};
```

The proxy exposes:

```http
PUT /config
GET /health
```

Configuration changes apply atomically to future arrivals. Messages already scheduled for forwarding keep the configuration that was active when they arrived.

The initial jitter model is:

```text
delay[i] = max(0, baseDelay + Normal(0, jitterSigma))
```

where `jitterMs` represents the standard deviation.

Departure times preserve FIFO order:

```text
sendTime[i] = max(
    sendTime[i - 1],
    arrivalTime[i] + jitteredDelay[i]
)
```

---

## Experimental Methodology

The project is designed for repeatable experiments rather than informal gameplay testing.

A trial is controlled by:

- initial game state
- bot input trajectory
- simulation constants
- tick rate
- network configuration
- proxy random seed
- compensation mode

Matched OFF/ON trials use the same initial state and deterministic input trajectory, and reuse the same proxy random stream where practical.

The primary independent variable is:

```text
Lag Compensation: OFF / ON
```

Network degradation is varied independently through:

```text
Latency × Jitter × Message Loss
```

---

## Experimental Metrics

### Hit-confirmation accuracy

The rate at which hit attempts are accepted correctly against the known simulation state at the relevant input time.

### Correction magnitude

The distance between predicted and authoritative local-player positions when reconciliation occurs:

```text
sqrt(
  (predicted_x - authoritative_x)^2 +
  (predicted_y - authoritative_y)^2
)
```

### Fairness metric

```text
|hit-rate_low-latency - hit-rate_high-latency|
```

### Target-side post-dodge acceptance rate

The fraction of accepted tags where the target had already moved away from the tagged position on the target's displayed timeline.

---

## Experiment Data

SQLite is used for experiment persistence, not live game-state updates.

The planned schema contains:

```text
experiment_run
trial
network_config
hit_event
correction_event
```

Runtime events are buffered in memory and flushed after a trial or run rather than performing synchronous database writes in the simulation hot path.

This keeps instrumentation from introducing the same timing disturbance that the experiments are trying to measure.

---

## Development Phases

The implementation follows the locked phase plan:

```text
Phase 0  Design Lock
   ↓
Phase 1  Bare authoritative server + dumb client
   ↓
Phase 2  Clock synchronization / RTT estimation
   ↓
Phase 3  Client-side prediction + reconciliation
   ↓
Phase 4  Remote entity interpolation
   ↓
Phase 5  Server history + lag compensation
   ↓
Phase 6  Minimal game rules
   ↓
Phase 7  Network degradation proxy
   ↓
Phase 8  Instrumentation + SQLite
   ↓
Phase 9  Deterministic experiment harness
   ↓
Phase 10 Analysis pipeline
   ↓
Phase 11 Full experiment sweep + write-up
```

### Phase 1 baseline

The first implementation target is intentionally minimal:

```text
Node + TypeScript authoritative server
        +
TypeScript browser client
        +
native WebSocket
        +
60 Hz fixed timestep
        +
raw server-authoritative movement
        +
localhost end-to-end validation
```

The Phase 1 client deliberately renders only server broadcasts. Prediction, reconciliation, interpolation, lag compensation, the proxy, and the experiment harness are added later.

This gives a working baseline before synchronization features are introduced.

---

## Scope

### Included

- two-player 2D tag game
- authoritative server simulation
- real-time WebSocket communication
- client-side prediction and reconciliation
- remote-player interpolation
- clock synchronization
- server-side lag compensation
- controlled latency, jitter, and message loss
- deterministic bot-based experiments
- SQLite experiment logging
- Python-based analysis and visualization

### Out of scope

- matchmaking
- accounts/authentication
- persistent game worlds
- cloud-scale deployment
- entity-component architecture
- generic N-player gameplay abstractions
- protocol-version negotiation
- binary protocol optimization
- production-grade distributed infrastructure

The game is a controlled experimental vehicle, not a commercial multiplayer game.

---

## Local Development

The primary development and demonstration environment is local or a controlled local network.

The project should first be validated end to end on `localhost` before controlled network degradation and automated experiments are introduced.

The repository currently contains the initial:

```text
client/
server/
```

As implementation progresses, setup and run commands will be documented here alongside each added service.

---

## Design Principles

The project keeps four concerns separate:

```text
Game simulation
    -> authoritative server

Player responsiveness
    -> client prediction + reconciliation

Remote visual smoothness
    -> snapshot interpolation

Experimental network conditions
    -> application-level proxy
```

Lag compensation changes **hit validation only**. It does not change movement simulation, client prediction, reconciliation, interpolation, server tick rate, or server authority.

---

## References

1. I. Fette and A. Melnikov, **The WebSocket Protocol**, RFC 6455, IETF, 2011.
2. MDN Web Docs, **WebSocket API (WebSockets)**.
3. `ws`, **Node.js WebSocket library**.
4. Y. W. Bernier, **Latency Compensating Methods in Client/Server In-game Protocol Design and Optimization**, Valve, 2001.
5. C. Savery and T. C. Nicholas Graham, **Timelines: simplifying the programming of lag compensation for the next generation of networked games**, Multimedia Systems, 2013.

---

## Project Team

- Himanshi Sharma (2023Btech035)
- Kopal Jain (2023Btech044)
- Vinay Lunawat (2023Btech098)

**Faculty Guide:** Devendra Bhavsar

**Institute:** Institute of Engineering and Technology (IET), JK Lakshmipat University

---

## Design Documentation

The repository is intended to maintain the following core documentation alongside the implementation:

```text
DESIGN.md     -> locked technical architecture and invariants
PROTOCOL.md   -> exact wire-level message specification
README.md     -> setup, architecture, implementation status, and usage
```

`DESIGN.md` is the technical contract for implementation. Changes to locked design decisions should be reviewed before dependent code is changed.
