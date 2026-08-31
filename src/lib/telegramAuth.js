// Direct port of validate_init_data() from server.py. Same algorithm
// Telegram documents for verifying Mini App initData:
// https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
//
// The short version of WHY this exists: when the Mini App opens inside
// Telegram, Telegram hands it a signed string (`initData`) proving who
// the user is. Anyone could fake a plain "user_id=123" query param, but
// they can't fake the signature without your bot's secret token — so
// every request that touches personal data re-checks this signature
// server-side rather than trusting whatever the client claims.
const crypto = require("crypto");

/**
 * @param {string} initData - the raw initData query string sent by the client
 * @param {string} botToken
 * @param {number} maxAgeSeconds - reject initData older than this (default 24h, same as the Python version)
 * @returns {object|null} the Telegram user object if valid, otherwise null
 */
function validateInitData(initData, botToken, maxAgeSeconds = 86400) {
  if (!initData) return null;

  // Step 1: parse the query string into a plain object. URLSearchParams
  // handles the URL-decoding for us. If the same key appears twice, the
  // last one wins — matches Python's dict(parse_qsl(...)) behaviour.
  let parsed;
  try {
    parsed = {};
    for (const [key, value] of new URLSearchParams(initData).entries()) {
      parsed[key] = value;
    }
  } catch {
    return null;
  }

  const receivedHash = parsed.hash;
  if (!receivedHash) return null;
  delete parsed.hash; // the hash itself isn't part of what gets signed

  // Step 2: rebuild the exact string Telegram signed — every remaining
  // key=value pair, alphabetically sorted, joined with newlines. Order
  // matters here: get this wrong and every signature will fail to verify.
  const dataCheckString = Object.keys(parsed)
    .sort()
    .map((k) => `${k}=${parsed[k]}`)
    .join("\n");

  // Step 3: Telegram's two-step HMAC. First, derive a "secret key" from
  // your bot token (never send the raw token itself into the comparison).
  // Then use THAT as the key to sign the data check string. This two-step
  // dance is Telegram's own spec, not something to redesign.
  const secretKey = crypto.createHmac("sha256", "WebAppData").update(botToken).digest();
  const computedHash = crypto.createHmac("sha256", secretKey).update(dataCheckString).digest("hex");

  // Step 4: compare hashes with a TIMING-SAFE comparison, not `===`.
  // A regular string comparison exits early on the first mismatched
  // character, which leaks (via response time) how many characters were
  // correct — enough for an attacker to guess a valid hash byte by byte
  // over many requests. crypto.timingSafeEqual always takes the same
  // amount of time regardless of where the mismatch is.
  const computedBuf = Buffer.from(computedHash, "hex");
  const receivedBuf = Buffer.from(receivedHash, "hex");
  if (computedBuf.length !== receivedBuf.length || !crypto.timingSafeEqual(computedBuf, receivedBuf)) {
    return null;
  }

  // Step 5: reject stale initData, even if the signature is still valid —
  // stops someone replaying an old, once-valid request indefinitely.
  const authDate = parseInt(parsed.auth_date || "0", 10);
  if (Date.now() / 1000 - authDate > maxAgeSeconds) return null;

  if (!parsed.user) return null;
  try {
    return JSON.parse(parsed.user);
  } catch {
    return null;
  }
}

module.exports = { validateInitData };
