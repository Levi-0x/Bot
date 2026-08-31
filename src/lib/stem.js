// Direct port of _stem() from database.py — same naive suffix-stripping
// approach, same suffix list, same order. It's not a real linguistic
// stemmer (no library, no dictionary), just "if the word ends in one of
// these, chop it off" — good enough to match "cleaner" against
// "cleaning" without pulling in a dependency for it.
const SUFFIXES = ["ians", "ing", "ers", "ors", "ian", "ees", "er", "es", "or", "s"];

function stem(word) {
  word = word.toLowerCase().trim();
  for (const suffix of SUFFIXES) {
    // The length check stops short words like "is" losing their "s" and
    // becoming a useless one-letter stem.
    if (word.endsWith(suffix) && word.length - suffix.length >= 3) {
      return word.slice(0, -suffix.length);
    }
  }
  return word;
}

module.exports = { stem };
