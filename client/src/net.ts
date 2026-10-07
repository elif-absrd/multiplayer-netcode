import { SERVER_PORT, decode, encode, type ClientMessage, type ServerMessage } from "@netcode/shared";
import { config } from "./config";

interface Handlers {
  onOpen: () => void;
  onMessage: (m: ServerMessage) => void;
}

export class Net {
  private ws: WebSocket;

  constructor(handlers: Handlers) {
    const half = config.fakeLagMs / 2; // dev-only artificial delay, each direction
    const envPort = Number(import.meta.env.VITE_SERVER_PORT);
    const port = Number.isFinite(envPort) && envPort > 0 ? envPort : SERVER_PORT;
    this.ws = new WebSocket(`ws://${location.hostname}:${port}`);
    this.ws.onopen = () => handlers.onOpen();
    this.ws.onclose = () => console.warn("disconnected");
    this.ws.onmessage = (e) => {
      const m = decode<ServerMessage>(e.data as string);
      if (!m) return;
      if (half > 0) setTimeout(() => handlers.onMessage(m), half);
      else handlers.onMessage(m);
    };
    this.halfLag = half;
  }

  private halfLag: number;

  send(msg: ClientMessage) {
    const data = encode(msg); // timestamps are already stamped inside msg
    const go = () => {
      if (this.ws.readyState === WebSocket.OPEN) this.ws.send(data);
    };
    if (this.halfLag > 0) setTimeout(go, this.halfLag);
    else go();
  }
}
