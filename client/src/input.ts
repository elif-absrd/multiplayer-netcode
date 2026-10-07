import { ARENA_H, ARENA_W, INPUT_FIRE, INPUT_SPRINT, type Pos } from "@netcode/shared";

const keys = new Set<string>();
let mouseDown = false;
let mouseWorld: Pos | null = null;
const BLOCKED = new Set([" ", "arrowup", "arrowdown", "arrowleft", "arrowright"]);

addEventListener("keydown", (e) => {
  const k = e.key.toLowerCase();
  if (BLOCKED.has(k)) e.preventDefault(); // stop the page scrolling
  keys.add(k);
});
addEventListener("keyup", (e) => keys.delete(e.key.toLowerCase()));
addEventListener("blur", () => keys.clear());
addEventListener("mousedown", () => {
  mouseDown = true;
});
addEventListener("mouseup", () => {
  mouseDown = false;
});
addEventListener("mousemove", (e) => {
  const canvas = document.getElementById("game") as HTMLCanvasElement | null;
  if (!canvas) return;

  const rect = canvas.getBoundingClientRect();
  mouseWorld = {
    x: ((e.clientX - rect.left) / rect.width) * ARENA_W,
    y: ((e.clientY - rect.top) / rect.height) * ARENA_H,
  };
});

export function readInput(origin: Pos | null): { dx: number; dy: number; aimX: number; aimY: number; inputBits: number } {
  const dx = (keys.has("d") || keys.has("arrowright") ? 1 : 0) - (keys.has("a") || keys.has("arrowleft") ? 1 : 0);
  const dy = (keys.has("s") || keys.has("arrowdown") ? 1 : 0) - (keys.has("w") || keys.has("arrowup") ? 1 : 0);
  const fallbackLen = Math.hypot(dx, dy);
  let aimX = fallbackLen > 0 ? dx / fallbackLen : 1;
  let aimY = fallbackLen > 0 ? dy / fallbackLen : 0;

  if (origin && mouseWorld) {
    const ax = mouseWorld.x - origin.x;
    const ay = mouseWorld.y - origin.y;
    const len = Math.hypot(ax, ay);
    if (len > 0.001) {
      aimX = ax / len;
      aimY = ay / len;
    }
  }

  let inputBits = 0;
  if (keys.has(" ") || mouseDown) inputBits |= INPUT_FIRE;
  if (keys.has("shift")) inputBits |= INPUT_SPRINT;

  return { dx, dy, aimX, aimY, inputBits };
}
