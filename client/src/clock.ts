import {
  PING_BURST, PING_BURST_GAP_MS, PING_INTERVAL_MS,
  type PingRequest, type PingResponse,
} from "@netcode/shared";

interface Sample {
  offset: number;
  rtt: number;
}

const WINDOW = 8;
const BEST = 3;

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

function clientNow(): number {
  return performance.timeOrigin + performance.now();
}

// Phase 2: NTP-style clock sync.
// serverTime ~= clientTime + offset
export class Clock {
  offset: number | null = null;
  rtt: number | null = null;
  jitter = 0;
  private samples: Sample[] = [];

  onPong(m: PingResponse, t3: number) {
    const t0 = m.clientTime;
    const rtt = t3 - t0;
    const offset = m.serverTime - (t0 + t3) / 2;

    this.samples.push({ offset, rtt });
    if (this.samples.length > WINDOW) this.samples.shift();

    const best = [...this.samples]
      .sort((a, b) => a.rtt - b.rtt)
      .slice(0, BEST);

    this.offset = mean(best.map((s) => s.offset));
    this.rtt = mean(this.samples.map((s) => s.rtt));

    this.jitter = mean(
      this.samples.map((s) => Math.abs(s.rtt - this.rtt!))
    );
  }

  serverTimeNow(): number | null {
    return this.offset === null
      ? null
      : clientNow() + this.offset;
  }
}

export function startClockSync(
  send: (m: PingRequest) => void,
  clock: Clock
) {
  const ping = () => {
    const m: PingRequest = {
      t: "ping",
      clientTime: clientNow(),
    };

    if (clock.offset !== null && clock.rtt !== null) {
      m.offset = clock.offset;
      m.rtt = clock.rtt;
    }

    send(m);
  };

  for (let i = 0; i < PING_BURST; i++) {
    setTimeout(ping, i * PING_BURST_GAP_MS);
  }

  setInterval(ping, PING_INTERVAL_MS);
}