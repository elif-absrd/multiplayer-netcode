import { samplePositions, type Pos, type ServerSnapshot, type TimelineEntry } from "@netcode/shared";

// Phase 4: buffer recent snapshots and sample them slightly in the past.
// 20 entries (~0.66 s) rather than 2-3, so a jitter spike doesn't empty the buffer.
const MAX_BUFFER = 20;

export class RemoteView {
  private buf: TimelineEntry[] = [];

  push(s: ServerSnapshot) {
    this.buf.push({ time: s.serverTime, players: s.players });
    if (this.buf.length > MAX_BUFFER) this.buf.shift();
  }

  // Positions at an arbitrary server time (clamped to the buffered range).
  sample(serverTime: number): Map<number, Pos> {
    return samplePositions(this.buf, serverTime);
  }
}