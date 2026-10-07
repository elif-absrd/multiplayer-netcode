// The ONE server clock. Epoch ms with sub-millisecond precision.
export function serverNow(): number {
  return performance.timeOrigin + performance.now();
}