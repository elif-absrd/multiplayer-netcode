import { INPUT_TAG } from "@netcode/shared";

const keys = new Set<string>();
const BLOCKED = new Set([" ", "arrowup", "arrowdown", "arrowleft", "arrowright"]);

addEventListener("keydown", (e) => {
  const k = e.key.toLowerCase();
  if (BLOCKED.has(k)) e.preventDefault(); // stop the page scrolling
  keys.add(k);
});
addEventListener("keyup", (e) => keys.delete(e.key.toLowerCase()));
addEventListener("blur", () => keys.clear());

export function readInput(): { dx: number; dy: number; inputBits: number } {
  const dx = (keys.has("d") || keys.has("arrowright") ? 1 : 0) - (keys.has("a") || keys.has("arrowleft") ? 1 : 0);
  const dy = (keys.has("s") || keys.has("arrowdown") ? 1 : 0) - (keys.has("w") || keys.has("arrowup") ? 1 : 0);
  const inputBits = keys.has(" ") ? INPUT_TAG : 0;
  return { dx, dy, inputBits };
}