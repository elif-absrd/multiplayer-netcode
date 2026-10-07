// URL switches, so one build can act as both the control and the treatment:
//   ?pred=0      disable client-side prediction     (Phase 1 behaviour)
//   ?interp=0    disable remote interpolation       (draw latest snapshot)
//   ?lag=200     DEV ONLY: fake round-trip delay in ms (half each way).
//                Replaced by the real proxy in Phase 7.
const q = new URLSearchParams(location.search);

export const config = {
  prediction: q.get("pred") !== "0",
  interpolation: q.get("interp") !== "0",
  fakeLagMs: Number(q.get("lag") ?? 0) || 0,
};