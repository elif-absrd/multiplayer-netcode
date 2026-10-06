// Phase 0 decisions: fixed 30 Hz tick, JSON encoding. Used by BOTH sides.
export const TICK_RATE = 30;
export const TICK_MS = 1000 / TICK_RATE;
export const TICK_DT = 1 / TICK_RATE; // seconds per time
export const ARENA_W = 800;
export const ARENA_H = 600;
export const PLAYER_RADIUS = 16;
export const PLAYER_SPEED = 220; // px/s

export const SERVER_PORT = 8080;

// Phase 2: clock sync
export const PING_BURST = 8;          // quick pings at startup so we converge fast
export const PING_BURST_GAP_MS = 100;
export const PING_INTERVAL_MS = 1000; // steady-state

// Phase 4: interpolation
export const INTERP_DELAY_MS = 100;   // remote entities are drawn this far in the past

// Phase 5: tagging + lag compensation
export const INPUT_TAG = 1;           // inputBits bit0
export const TAG_RANGE = 48;          // centre-to-centre px
export const TAG_COOLDOWN_TICKS = 15; // 0.5 s (pulled forward from Phase 6 so hits don't spam)
export const HISTORY_TICKS = TICK_RATE; // ~1 s of history on the server
export const MAX_REWIND_MS = 500;     // never rewind further than thiswind further than this