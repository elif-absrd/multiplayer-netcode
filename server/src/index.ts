import { WebSocketServer, WebSocket } from "ws";
import {
  SERVER_PORT, TICK_MS, TICK_RATE,
  decode, encode,
  type ClientMessage,
} from "@netcode/shared";
import { Game } from "./game";
import { serverNow } from "./time";

// Experiment variable: LAG_COMP=0 disables compensation (Phase 9 will drive this).
const lagComp = process.env.LAG_COMP !== "0";
const game = new Game({ lagComp });
const wss = new WebSocketServer({ port: SERVER_PORT });
const sockets = new Map<WebSocket, number>();

wss.on("connection", (ws) => {
  const id = game.addPlayer();
  sockets.set(ws, id);
  ws.send(encode({ t: "welcome", id, tickRate: TICK_RATE, lagComp }));
  console.log(`player ${id} connected (${sockets.size} online)`);

  ws.on("message", (data) => {
    const msg = decode<ClientMessage>(data.toString());
    if (!msg) return;

    if (msg.t === "input") {
      game.queueInput(id, msg);
    } else if (msg.t === "ping") {
      ws.send(encode({ t: "pong", clientTime: msg.clientTime, serverTime: serverNow() }));
      if (
        typeof msg.offset === "number" && typeof msg.rtt === "number" &&
        Number.isFinite(msg.offset) && Number.isFinite(msg.rtt)
      ) {
        game.setClock(id, msg.offset, msg.rtt);
      }
    }
  });

  ws.on("close", () => {
    game.removePlayer(id);
    sockets.delete(ws);
    console.log(`player ${id} left`);
  });
});

// Drift-corrected fixed-timestep loop (setInterval drifts and bunches up).
let next = performance.now() + TICK_MS;
function loop() {
  game.update();
  const payload = encode(game.snapshot());
  for (const ws of sockets.keys()) {
    if (ws.readyState === WebSocket.OPEN) ws.send(payload);
  }
  next += TICK_MS;
  setTimeout(loop, Math.max(0, next - performance.now()));
}
loop();

console.log(`server on ws://localhost:${SERVER_PORT} @ ${TICK_RATE} Hz, lag compensation ${lagComp ? "ON" : "OFF"}`);