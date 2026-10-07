import { SHOT_RANGE } from "./constants";
import { WALLS, type Wall } from "./world";

export interface Ray {
  x: number;
  y: number;
  dx: number;
  dy: number;
  range: number;
}

export interface CircleTarget {
  id: number;
  x: number;
  y: number;
  radius: number;
}

export function normalizeAim(dx: number, dy: number, fallbackX = 1, fallbackY = 0) {
  const len = Math.hypot(dx, dy);
  if (len > 0.0001) return { aimX: dx / len, aimY: dy / len };

  const fallbackLen = Math.hypot(fallbackX, fallbackY);
  if (fallbackLen > 0.0001) return { aimX: fallbackX / fallbackLen, aimY: fallbackY / fallbackLen };

  return { aimX: 1, aimY: 0 };
}

export function rayCircleDistance(ray: Ray, target: CircleTarget): number | null {
  const fx = target.x - ray.x;
  const fy = target.y - ray.y;
  const along = fx * ray.dx + fy * ray.dy;
  if (along < 0 || along > ray.range) return null;

  const closestX = ray.x + ray.dx * along;
  const closestY = ray.y + ray.dy * along;
  const miss = Math.hypot(target.x - closestX, target.y - closestY);
  return miss <= target.radius ? along : null;
}

export function rayRectDistance(ray: Ray, wall: Wall): number | null {
  const endX = ray.x + ray.dx * ray.range;
  const endY = ray.y + ray.dy * ray.range;
  const sx = endX - ray.x;
  const sy = endY - ray.y;
  let tMin = 0;
  let tMax = 1;

  const clip = (origin: number, size: number, start: number, delta: number) => {
    if (Math.abs(delta) < 0.0001) return start >= origin && start <= origin + size;

    const inv = 1 / delta;
    let near = (origin - start) * inv;
    let far = (origin + size - start) * inv;
    if (near > far) [near, far] = [far, near];

    tMin = Math.max(tMin, near);
    tMax = Math.min(tMax, far);
    return tMin <= tMax;
  };

  if (!clip(wall.x, wall.w, ray.x, sx)) return null;
  if (!clip(wall.y, wall.h, ray.y, sy)) return null;
  if (tMax < 0 || tMin > 1) return null;

  return Math.max(0, tMin) * ray.range;
}

export function firstWallDistance(ray: Ray): number | null {
  let best: number | null = null;

  for (const wall of WALLS) {
    const hit = rayRectDistance(ray, wall);
    if (hit === null) continue;
    if (best === null || hit < best) best = hit;
  }

  return best;
}

export function makeShotRay(x: number, y: number, aimX: number, aimY: number): Ray {
  const aim = normalizeAim(aimX, aimY);
  return { x, y, dx: aim.aimX, dy: aim.aimY, range: SHOT_RANGE };
}
