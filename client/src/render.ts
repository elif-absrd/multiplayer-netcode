import {
  ARENA_H,
  ARENA_W,
  PLAYER_RADIUS,
} from "@netcode/shared";

let canvas: HTMLCanvasElement | null = null;
let ctx: CanvasRenderingContext2D | null = null;

function getContext(): CanvasRenderingContext2D {
  if (!canvas) {
    canvas = document.getElementById("game") as HTMLCanvasElement | null;

    if (!canvas) {
      throw new Error("Game canvas #game was not found");
    }

    canvas.width = ARENA_W;
    canvas.height = ARENA_H;
  }

  if (!ctx) {
    const context = canvas.getContext("2d");

    if (!context) {
      throw new Error("Could not get 2D canvas context");
    }

    ctx = context;
  }

  return ctx;
}

export interface Drawn {
  id: number;
  x: number;
  y: number;
}

export function render(
  players: Drawn[],
  myId: number | null,
  ghost: Drawn | null,
  flashing: ReadonlySet<number>,
) {
  const context = getContext();

  context.clearRect(0, 0, ARENA_W, ARENA_H);

  for (const p of players) {
    context.beginPath();

    context.arc(
      p.x,
      p.y,
      PLAYER_RADIUS,
      0,
      Math.PI * 2,
    );

    context.fillStyle =
      p.id === myId
        ? "#4ade80"
        : "#f87171";

    context.fill();

    if (flashing.has(p.id)) {
      context.lineWidth = 4;
      context.strokeStyle = "#fff";
      context.stroke();
    }
  }

  if (ghost) {
    context.beginPath();

    context.arc(
      ghost.x,
      ghost.y,
      PLAYER_RADIUS,
      0,
      Math.PI * 2,
    );

    context.lineWidth = 1;
    context.setLineDash([4, 4]);
    context.strokeStyle = "#4ade80";
    context.stroke();

    context.setLineDash([]);
  }
}