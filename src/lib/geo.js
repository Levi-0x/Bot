// The Postgres version computes distance with a raw Haversine expression
// written directly into the SQL string. MongoDB has a real equivalent
// for this — a 2dsphere index plus $geoNear — but that requires storing
// coordinates as proper GeoJSON Points, which is a bigger schema change
// than this conversion takes on. For a directory this size, computing
// the same formula here in plain JS after fetching candidates is a
// perfectly reasonable trade (see the note on findByService() in
// repository.js for where this gets called).
//
// The formula itself: it finds the "great-circle" distance between two
// points on a sphere (Earth) given their latitude/longitude — a straight
// line through the Earth wouldn't work, this accounts for the curve.
function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371; // Earth's radius in km
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

module.exports = { haversineKm };
