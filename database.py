"""
database.py
------------
This file is the "pantry" of our restaurant analogy: it's the only place
that ever touches the actual data. Every other file asks THIS file to
fetch or change something — nobody else talks to the database directly.

We use SQLite because it's just a single file (entrepreneurs.db) on your
computer. No server to install, no password to configure. Perfect for
learning, and easy to swap out for PostgreSQL/MongoDB later since all
the database logic is isolated here.

TABLES (like labeled folders in a filing cabinet):
  entrepreneurs        -> one row per person who registers
  services             -> one row per unique service name ("plumber", "designer"...)
  entrepreneur_services -> the "join table" linking entrepreneurs <-> services
                           (many-to-many: one person can offer many services,
                            one service can have many people)
  ratings              -> one row per individual rating given to someone
"""

import sqlite3
from contextlib import contextmanager

DB_PATH = "entrepreneurs.db"

# Endings checked longest-first, so "teachers" strips to "teach" via "ers"
# rather than incorrectly stopping at "teacher" via "s".
_SUFFIXES = ["ians", "ing", "ers", "ors", "ian", "ees", "er", "es", "or", "s"]


def _stem(word: str) -> str:
    """
    A deliberately simple stemmer: strips common word endings so related
    words collapse to the same root. "teacher" and "teaching" both
    become "teach"; "plumber" and "plumbing" both become "plumb".
    This isn't linguistically perfect, but it's transparent, fast, and
    covers the common case of someone searching a different form of
    a word than what was registered.
    """
    word = word.lower().strip()
    for suffix in _SUFFIXES:
        if word.endswith(suffix) and len(word) - len(suffix) >= 3:
            return word[: -len(suffix)]
    return word


@contextmanager
def get_connection():
    """
    Opens a connection to the database file and makes sure it's
    always closed properly afterwards, even if an error happens.
    Think of this like "unlocking the pantry, then re-locking it
    automatically when you're done" so you never forget.
    """
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row  # lets us access columns by name, e.g. row["name"]
    conn.execute("PRAGMA foreign_keys = ON")
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()


def init_db():
    """
    Creates all the tables if they don't exist yet.
    Safe to call every time the bot starts up.
    """
    with get_connection() as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS entrepreneurs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                telegram_id INTEGER UNIQUE NOT NULL,
                name TEXT NOT NULL,
                socials TEXT,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP
            )
        """)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS services (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT UNIQUE NOT NULL COLLATE NOCASE
            )
        """)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS entrepreneur_services (
                entrepreneur_id INTEGER NOT NULL,
                service_id INTEGER NOT NULL,
                FOREIGN KEY (entrepreneur_id) REFERENCES entrepreneurs(id) ON DELETE CASCADE,
                FOREIGN KEY (service_id) REFERENCES services(id) ON DELETE CASCADE,
                PRIMARY KEY (entrepreneur_id, service_id)
            )
        """)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS ratings (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                entrepreneur_id INTEGER NOT NULL,
                rater_telegram_id INTEGER NOT NULL,
                score INTEGER NOT NULL CHECK (score BETWEEN 1 AND 5),
                created_at TEXT DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (entrepreneur_id) REFERENCES entrepreneurs(id) ON DELETE CASCADE
            )
        """)


# ---------- Entrepreneur registration ----------

def register_entrepreneur(telegram_id: int, name: str, socials: str, service_names: list[str]):
    """
    Adds a new entrepreneur, or updates their info if they already registered
    (identified by their Telegram user id, so people can't impersonate others).
    `service_names` is a list like ["plumber", "electrician"].
    """
    with get_connection() as conn:
        conn.execute("""
            INSERT INTO entrepreneurs (telegram_id, name, socials)
            VALUES (?, ?, ?)
            ON CONFLICT(telegram_id) DO UPDATE SET name=excluded.name, socials=excluded.socials
        """, (telegram_id, name, socials))

        entrepreneur_id = conn.execute(
            "SELECT id FROM entrepreneurs WHERE telegram_id = ?", (telegram_id,)
        ).fetchone()["id"]

        # Clear old service links so re-registering replaces the list cleanly
        conn.execute("DELETE FROM entrepreneur_services WHERE entrepreneur_id = ?", (entrepreneur_id,))

        for raw_name in service_names:
            service_name = raw_name.strip().lower()
            if not service_name:
                continue
            conn.execute("INSERT OR IGNORE INTO services (name) VALUES (?)", (service_name,))
            service_id = conn.execute(
                "SELECT id FROM services WHERE name = ?", (service_name,)
            ).fetchone()["id"]
            conn.execute(
                "INSERT OR IGNORE INTO entrepreneur_services (entrepreneur_id, service_id) VALUES (?, ?)",
                (entrepreneur_id, service_id)
            )

    return entrepreneur_id


# ---------- Searching ----------

def get_all_services():
    """
    Returns every distinct service name currently registered, with how
    many entrepreneurs offer each one. Powers the browsable /services menu.
    """
    with get_connection() as conn:
        rows = conn.execute("""
            SELECT s.name, COUNT(es.entrepreneur_id) AS entrepreneur_count
            FROM services s
            JOIN entrepreneur_services es ON es.service_id = s.id
            GROUP BY s.name
            ORDER BY s.name ASC
        """).fetchall()
        return [dict(row) for row in rows]


def find_by_service(service_query: str):
    """
    Returns a list of entrepreneurs whose service matches the query.
    Matching happens in two passes:
      1. Exact/partial text match (fast, catches most cases directly)
      2. Stem match — "teacher" typed in finds "teaching" registered,
         because both reduce to the root "teach"
    Each result includes their name, socials, matched service, and average rating.
    """
    query_stem = _stem(service_query)

    with get_connection() as conn:
        all_services = [row["name"] for row in conn.execute("SELECT name FROM services").fetchall()]

        matching_services = [
            name for name in all_services
            if service_query.strip().lower() in name.lower()  # direct substring match
            or query_stem in _stem(name)                       # stemmed root match
            or _stem(name) in query_stem
        ]

        if not matching_services:
            return []

        placeholders = ",".join("?" for _ in matching_services)
        rows = conn.execute(f"""
            SELECT
                e.id,
                e.name,
                e.socials,
                s.name AS service,
                ROUND(AVG(r.score), 1) AS avg_rating,
                COUNT(r.id) AS rating_count
            FROM entrepreneurs e
            JOIN entrepreneur_services es ON es.entrepreneur_id = e.id
            JOIN services s ON s.id = es.service_id
            LEFT JOIN ratings r ON r.entrepreneur_id = e.id
            WHERE s.name IN ({placeholders})
            GROUP BY e.id, s.name
            ORDER BY avg_rating DESC NULLS LAST
        """, matching_services).fetchall()
        return [dict(row) for row in rows]


# ---------- Ratings ----------

def rate_entrepreneur(name: str, rater_telegram_id: int, score: int):
    """
    Adds a rating (1-5) for an entrepreneur found by name.
    Returns (success: bool, message: str) so the bot can report back clearly.
    """
    with get_connection() as conn:
        match = conn.execute(
            "SELECT id, name FROM entrepreneurs WHERE name LIKE ?", (f"%{name.strip()}%",)
        ).fetchone()

        if not match:
            return False, f'No entrepreneur found matching "{name}".'

        conn.execute(
            "INSERT INTO ratings (entrepreneur_id, rater_telegram_id, score) VALUES (?, ?, ?)",
            (match["id"], rater_telegram_id, score)
        )
        return True, f'Rated {match["name"]} {score}/5.'


def get_stats():
    """Simple counts across the whole bot — powers the admin /stats command."""
    with get_connection() as conn:
        entrepreneurs = conn.execute("SELECT COUNT(*) AS c FROM entrepreneurs").fetchone()["c"]
        services = conn.execute("SELECT COUNT(*) AS c FROM services").fetchone()["c"]
        ratings = conn.execute("SELECT COUNT(*) AS c FROM ratings").fetchone()["c"]
        return {"entrepreneurs": entrepreneurs, "services": services, "ratings": ratings}


def get_all_telegram_ids():
    """Every registered entrepreneur's Telegram ID — used for /broadcast."""
    with get_connection() as conn:
        rows = conn.execute("SELECT telegram_id FROM entrepreneurs").fetchall()
        return [row["telegram_id"] for row in rows]


def force_delete_by_name(name: str):
    """
    Admin version of unregister — removes ANY entrepreneur by name,
    not just the person calling it. Returns (success, telegram_id).
    """
    with get_connection() as conn:
        match = conn.execute(
            "SELECT telegram_id FROM entrepreneurs WHERE name LIKE ?", (f"%{name.strip()}%",)
        ).fetchone()
        if not match:
            return False, None
        conn.execute("DELETE FROM entrepreneurs WHERE telegram_id = ?", (match["telegram_id"],))
        return True, match["telegram_id"]


def delete_entrepreneur(telegram_id: int):
    """
    Removes an entrepreneur completely: their profile, their service
    links, and every rating they've received. Because our tables were
    created with 'ON DELETE CASCADE', deleting the one row in
    `entrepreneurs` automatically cleans up the matching rows in
    `entrepreneur_services` and `ratings` too — we don't have to
    delete from each table by hand.

    Returns True if someone was actually removed, False if this
    telegram_id had no registration to begin with.
    """
    with get_connection() as conn:
        cursor = conn.execute(
            "DELETE FROM entrepreneurs WHERE telegram_id = ?", (telegram_id,)
        )
        return cursor.rowcount > 0


def add_services(telegram_id: int, service_names: list[str]):
    """
    Adds one or more services to an ALREADY registered entrepreneur,
    without touching their existing services (unlike register_entrepreneur,
    which replaces the whole list). Returns False if this telegram_id
    hasn't registered yet.
    """
    with get_connection() as conn:
        row = conn.execute(
            "SELECT id FROM entrepreneurs WHERE telegram_id = ?", (telegram_id,)
        ).fetchone()
        if not row:
            return False

        entrepreneur_id = row["id"]
        for raw_name in service_names:
            service_name = raw_name.strip().lower()
            if not service_name:
                continue
            conn.execute("INSERT OR IGNORE INTO services (name) VALUES (?)", (service_name,))
            service_id = conn.execute(
                "SELECT id FROM services WHERE name = ?", (service_name,)
            ).fetchone()["id"]
            conn.execute(
                "INSERT OR IGNORE INTO entrepreneur_services (entrepreneur_id, service_id) VALUES (?, ?)",
                (entrepreneur_id, service_id)
            )
        return True


def remove_services(telegram_id: int, service_names: list[str]):
    """
    Removes one or more services from an entrepreneur's list, leaving
    everything else untouched. Note: this only removes the *link*
    between this entrepreneur and the service — it doesn't delete the
    service itself, since other entrepreneurs might still offer it.
    Returns False if this telegram_id hasn't registered yet.
    """
    with get_connection() as conn:
        row = conn.execute(
            "SELECT id FROM entrepreneurs WHERE telegram_id = ?", (telegram_id,)
        ).fetchone()
        if not row:
            return False

        entrepreneur_id = row["id"]
        for raw_name in service_names:
            service_name = raw_name.strip().lower()
            if not service_name:
                continue
            service_row = conn.execute(
                "SELECT id FROM services WHERE name = ?", (service_name,)
            ).fetchone()
            if service_row:
                conn.execute(
                    "DELETE FROM entrepreneur_services WHERE entrepreneur_id = ? AND service_id = ?",
                    (entrepreneur_id, service_row["id"])
                )
        return True


def get_entrepreneur_profile(telegram_id: int):
    """Fetch one entrepreneur's own profile, including their full list of services."""
    with get_connection() as conn:
        row = conn.execute(
            "SELECT * FROM entrepreneurs WHERE telegram_id = ?", (telegram_id,)
        ).fetchone()
        if not row:
            return None

        profile = dict(row)
        services = conn.execute("""
            SELECT s.name FROM services s
            JOIN entrepreneur_services es ON es.service_id = s.id
            WHERE es.entrepreneur_id = ?
        """, (profile["id"],)).fetchall()
        profile["services"] = [s["name"] for s in services]
        return profile
