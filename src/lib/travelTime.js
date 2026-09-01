/**
 * lib/travelTime.js
 * -------------------
 * Converts a straight-line distance (km) into a ROUGH "how long might
 * this take" estimate for display purposes only. This is deliberately
 * NOT real routing — no road network, no traffic data, no live
 * conditions. It's one flat average speed applied to the same
 * straight-line distance haversineKm() already computes.
 *
 * AVG_SPEED_KMH is the one number this whole estimate hinges on, and
 * it's picked deliberately conservative (slow) rather than optimistic:
 * a published study of Lagos traffic found rush-hour average speeds of
 * 15–25 km/h, with genuinely free-flowing conditions only reliably
 * showing up around midday. Since a lot of "come do this job" travel
 * plausibly happens during working hours — which overlaps rush hour —
 * erring toward the slower end means the estimate is more likely to be
 * pleasantly wrong (arrived sooner than expected) than the reverse,
 * which matters a lot more for trust than raw accuracy does.
 *
 * If real complaints start showing up along the lines of "it said 15
 * minutes and took an hour," THAT'S the signal to replace this with a
 * real routing API (Google Distance Matrix, Mapbox) — not something to
 * pre-solve now on a guess. See the note in jobRepository.js.
 */

const AVG_SPEED_KMH = 15;

// Rounds to a "clean" number on purpose — 17 minutes reads like a
// precise promise; "~15 min" reads like what it actually is, an
// estimate. Nearest 5 under an hour, nearest 10 above it (an hour+ trip
// doesn't need 5-minute precision to still be a useful signal).
function estimateMinutes(km) {
  if (km == null) return null;
  const rawMinutes = (km / AVG_SPEED_KMH) * 60;
  const roundTo = rawMinutes < 60 ? 5 : 10;
  return Math.max(roundTo, Math.round(rawMinutes / roundTo) * roundTo);
}

function formatTravelEstimate(km) {
  const minutes = estimateMinutes(km);
  if (minutes == null) return null;
  const label = minutes >= 60 ? `~${Math.round((minutes / 60) * 10) / 10}h` : `~${minutes} min`;
  return { minutes, label };
}

module.exports = { AVG_SPEED_KMH, estimateMinutes, formatTravelEstimate };
