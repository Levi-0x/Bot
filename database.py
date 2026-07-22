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
    Creates all the tables if they don't exist yet, and migrates older
    databases to the newer schema (adds new columns without touching
    existing data). Safe to call every time the bot starts up.
    """
    with get_connection() as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS entrepreneurs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                telegram_id INTEGER UNIQUE NOT NULL,
                name TEXT NOT NULL,
                socials TEXT,
                phone TEXT,
                email TEXT,
                photo_file_id TEXT,
                photo_base64 TEXT,
                business_address TEXT,
                website TEXT,
                home_address TEXT,
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
        conn.execute("""
            CREATE TABLE IF NOT EXISTS phone_verifications (
                telegram_id INTEGER PRIMARY KEY,
                phone TEXT NOT NULL,
                verified_at TEXT DEFAULT CURRENT_TIMESTAMP
            )
        """)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS verification_requests (
                telegram_id INTEGER PRIMARY KEY,
                requested_at TEXT DEFAULT CURRENT_TIMESTAMP,
                status TEXT DEFAULT 'pending'
            )
        """)

        conn.execute("""
            CREATE TABLE IF NOT EXISTS admins (
                telegram_id INTEGER PRIMARY KEY,
                added_by INTEGER,
                added_at TEXT DEFAULT CURRENT_TIMESTAMP
            )
        """)

        # ---- Migration: add any new columns that older deployed databases
        # (like one already running on Render) won't have yet. SQLite doesn't
        # support "ADD COLUMN IF NOT EXISTS", so we check what already exists
        # first, and only add what's missing. Existing rows keep their data;
        # new columns just start out empty (NULL) until someone fills them in.
        existing_columns = {row["name"] for row in conn.execute("PRAGMA table_info(entrepreneurs)")}
        new_columns = {
            "phone": "TEXT",
            "email": "TEXT",
            "photo_file_id": "TEXT",
            "photo_base64": "TEXT",
            "business_address": "TEXT",
            "website": "TEXT",
            "home_address": "TEXT",
            "phone_verified": "INTEGER DEFAULT 0",
            "identity_verified": "INTEGER DEFAULT 0",
            "verified_at": "TEXT",
            "latitude": "REAL",
            "longitude": "REAL",
            "location_captured_at": "TEXT",
        }
        for column, col_type in new_columns.items():
            if column not in existing_columns:
                conn.execute(f"ALTER TABLE entrepreneurs ADD COLUMN {column} {col_type}")


# ---------- Entrepreneur registration ----------

def register_entrepreneur(telegram_id: int, fields: dict, service_names: list[str]):
    """
    Adds a new entrepreneur, or updates their info if they already registered.
    `fields` is a dict with any of: name, socials, phone, email, photo_file_id,
    photo_base64, business_address, website, home_address.
    `service_names` is a list like ["plumber", "electrician"].

    Note on privacy: home_address is stored here like any other field, but by
    design NO read function below (find_by_service, get_top_entrepreneurs)
    ever selects it — only get_entrepreneur_profile does, which is only ever
    called for a person looking at their OWN profile. That boundary is what
    keeps it private; it's enforced here in the database layer on purpose.
    """
    allowed_columns = {
        "name", "socials", "phone", "email", "photo_file_id", "photo_base64",
        "business_address", "website", "home_address", "latitude", "longitude",
        "phone_verified"
    }
    fields = {k: v for k, v in fields.items() if k in allowed_columns}

    with get_connection() as conn:
        # If this person already verified a phone via Telegram's own contact
        # share, that number is authoritative — we use it regardless of
        # whatever was typed into the phone field, and mark it verified.
        # This is what makes phone verification meaningful rather than
        # cosmetic: the stored number is guaranteed to be the real one.
        verified = conn.execute(
            "SELECT phone FROM phone_verifications WHERE telegram_id = ?", (telegram_id,)
        ).fetchone()
        if verified:
            fields["phone"] = verified["phone"]
            fields["phone_verified"] = 1

        existing = conn.execute(
            "SELECT id FROM entrepreneurs WHERE telegram_id = ?", (telegram_id,)
        ).fetchone()

        if existing:
            # Update only the fields provided, leaving anything not passed untouched
            set_clause = ", ".join(f"{col} = ?" for col in fields)
            conn.execute(
                f"UPDATE entrepreneurs SET {set_clause} WHERE telegram_id = ?",
                (*fields.values(), telegram_id)
            )
            entrepreneur_id = existing["id"]
        else:
            columns = ", ".join(fields.keys())
            placeholders = ", ".join("?" for _ in fields)
            cursor = conn.execute(
                f"INSERT INTO entrepreneurs (telegram_id, {columns}) VALUES (?, {placeholders})",
                (telegram_id, *fields.values())
            )
            entrepreneur_id = cursor.lastrowid

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

def get_top_entrepreneurs(limit: int = 5):
    """
    Returns entrepreneurs sorted by average rating (best first), each with
    their full list of services combined into one row. Powers the "Top
    Entrepreneurs" section on the Mini App's Home tab.
    """
    with get_connection() as conn:
        rows = conn.execute("""
            SELECT
                e.id,
                e.name,
                e.socials,
                e.phone,
                e.email,
                e.business_address,
                e.website,
                e.photo_file_id,
                e.photo_base64,
                e.phone_verified,
                e.identity_verified,
                GROUP_CONCAT(DISTINCT s.name) AS services_csv,
                ROUND(AVG(r.score), 1) AS avg_rating,
                COUNT(DISTINCT r.id) AS rating_count
            FROM entrepreneurs e
            LEFT JOIN entrepreneur_services es ON es.entrepreneur_id = e.id
            LEFT JOIN services s ON s.id = es.service_id
            LEFT JOIN ratings r ON r.entrepreneur_id = e.id
            GROUP BY e.id
            ORDER BY avg_rating DESC NULLS LAST, rating_count DESC
            LIMIT ?
        """, (limit,)).fetchall()

        results = []
        for row in rows:
            d = dict(row)
            d["services"] = d["services_csv"].split(",") if d["services_csv"] else []
            del d["services_csv"]
            results.append(d)
        return results


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
                e.phone,
                e.email,
                e.business_address,
                e.website,
                e.photo_file_id,
                e.photo_base64,
                e.phone_verified,
                e.identity_verified,
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

def rate_entrepreneur_by_id(entrepreneur_id: int, rater_telegram_id: int, score: int):
    """
    Adds a rating (1-5) for an entrepreneur found by their internal id —
    used by the Mini App's detail page. If this rater already rated this
    entrepreneur before, their existing rating is UPDATED in place rather
    than adding a new row — otherwise one person could submit unlimited
    ratings and skew the average arbitrarily.
    """
    with get_connection() as conn:
        match = conn.execute(
            "SELECT id FROM entrepreneurs WHERE id = ?", (entrepreneur_id,)
        ).fetchone()
        if not match:
            return False

        existing = conn.execute(
            "SELECT id FROM ratings WHERE entrepreneur_id = ? AND rater_telegram_id = ?",
            (entrepreneur_id, rater_telegram_id)
        ).fetchone()

        if existing:
            conn.execute(
                "UPDATE ratings SET score = ?, created_at = CURRENT_TIMESTAMP WHERE id = ?",
                (score, existing["id"])
            )
        else:
            conn.execute(
                "INSERT INTO ratings (entrepreneur_id, rater_telegram_id, score) VALUES (?, ?, ?)",
                (entrepreneur_id, rater_telegram_id, score)
            )
        return True


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


def get_admin_ids_from_db():
    """Admins added via the bot (fast path) — on top of the ADMIN_IDS env var (root admins)."""
    with get_connection() as conn:
        rows = conn.execute("SELECT telegram_id FROM admins").fetchall()
        return {row["telegram_id"] for row in rows}


def add_admin(telegram_id: int, added_by: int):
    with get_connection() as conn:
        conn.execute(
            "INSERT OR IGNORE INTO admins (telegram_id, added_by) VALUES (?, ?)",
            (telegram_id, added_by)
        )


def remove_admin(telegram_id: int):
    """Only removes DB-added admins. Root admins (from ADMIN_IDS) aren't stored here at all,
    so this can never accidentally revoke someone set via Render — that's by design."""
    with get_connection() as conn:
        cursor = conn.execute("DELETE FROM admins WHERE telegram_id = ?", (telegram_id,))
        return cursor.rowcount > 0


def set_verified_phone(telegram_id: int, phone: str):
    """
    Called when someone shares their REAL phone number via Telegram's native
    requestContact() flow — Telegram itself confirms this number belongs to
    that account. Stored in its own table (not just on the entrepreneurs
    row) because this needs to work BEFORE someone finishes registering —
    the Mini App checks this table to gate the registration form itself,
    not just to display a badge afterward. If they're already registered,
    we also sync it onto their live listing immediately.
    """
    with get_connection() as conn:
        conn.execute("""
            INSERT INTO phone_verifications (telegram_id, phone, verified_at)
            VALUES (?, ?, CURRENT_TIMESTAMP)
            ON CONFLICT(telegram_id) DO UPDATE SET phone=excluded.phone, verified_at=CURRENT_TIMESTAMP
        """, (telegram_id, phone))

        conn.execute(
            "UPDATE entrepreneurs SET phone = ?, phone_verified = 1 WHERE telegram_id = ?",
            (phone, telegram_id)
        )


def set_location_captured_now(telegram_id: int):
    with get_connection() as conn:
        conn.execute(
            "UPDATE entrepreneurs SET location_captured_at = CURRENT_TIMESTAMP WHERE telegram_id = ?",
            (telegram_id,)
        )


def get_phone_verification(telegram_id: int):
    """Returns {'phone': ..., 'verified_at': ...} if this Telegram user has ever verified a phone, else None."""
    with get_connection() as conn:
        row = conn.execute(
            "SELECT phone, verified_at FROM phone_verifications WHERE telegram_id = ?", (telegram_id,)
        ).fetchone()
        return dict(row) if row else None


def request_verification(telegram_id: int):
    """
    An entrepreneur asks to be reviewed for the manual 'Verified' badge.
    This is opt-in and pre-filtered on the caller side (server.py only
    allows this if phone is already verified and a photo exists) — the
    point is admins only ever look at a small, self-selected queue of
    people who actually want the badge, not every registered entrepreneur.
    """
    with get_connection() as conn:
        conn.execute(
            "INSERT OR IGNORE INTO verification_requests (telegram_id, status) VALUES (?, 'pending')",
            (telegram_id,)
        )


def get_verification_queue():
    """Pending verification requests, enriched with what an admin needs to make a quick call."""
    with get_connection() as conn:
        rows = conn.execute("""
            SELECT
                e.telegram_id, e.id, e.name, e.phone, e.phone_verified, e.business_address,
                e.photo_file_id, e.photo_base64, vr.requested_at
            FROM verification_requests vr
            JOIN entrepreneurs e ON e.telegram_id = vr.telegram_id
            WHERE vr.status = 'pending'
            ORDER BY vr.requested_at ASC
        """).fetchall()
        return [dict(row) for row in rows]


def resolve_verification_request(entrepreneur_telegram_id: int, approve: bool):
    """Admin approves or rejects a pending request — updates both the queue and the live badge."""
    with get_connection() as conn:
        conn.execute(
            "UPDATE verification_requests SET status = ? WHERE telegram_id = ?",
            ("approved" if approve else "rejected", entrepreneur_telegram_id)
        )
        conn.execute(
            "UPDATE entrepreneurs SET identity_verified = ?, verified_at = CASE WHEN ? THEN CURRENT_TIMESTAMP ELSE verified_at END WHERE telegram_id = ?",
            (1 if approve else 0, approve, entrepreneur_telegram_id)
        )


def set_identity_verified_by_name(name: str, verified: bool):
    """
    Admin-only manual verification badge — there's no automated way to
    confirm someone actually lives/works at a claimed address without a
    paid ID-verification service, so this is a deliberate manual step:
    an admin does their own diligence, then flips this flag.
    """
    with get_connection() as conn:
        match = conn.execute(
            "SELECT telegram_id FROM entrepreneurs WHERE name LIKE ?", (f"%{name.strip()}%",)
        ).fetchone()
        if not match:
            return False, None
        conn.execute(
            "UPDATE entrepreneurs SET identity_verified = ?, verified_at = CASE WHEN ? THEN CURRENT_TIMESTAMP ELSE verified_at END WHERE telegram_id = ?",
            (1 if verified else 0, verified, match["telegram_id"])
        )
        return True, match["telegram_id"]


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


def get_public_profile(entrepreneur_id: int):
    """
    Fetch one entrepreneur's PUBLIC detail page — everything they'd want
    a potential client to see. Deliberately excludes telegram_id and
    home_address (same privacy boundary as find_by_service/get_top_entrepreneurs,
    just for a single entrepreneur instead of a list).
    """
    with get_connection() as conn:
        row = conn.execute("""
            SELECT id, name, socials, phone, email, business_address, website,
                   photo_file_id, photo_base64, created_at, phone_verified, identity_verified,
                   location_captured_at
            FROM entrepreneurs WHERE id = ?
        """, (entrepreneur_id,)).fetchone()
        if not row:
            return None

        profile = dict(row)
        services = conn.execute("""
            SELECT s.name FROM services s
            JOIN entrepreneur_services es ON es.service_id = s.id
            WHERE es.entrepreneur_id = ?
        """, (entrepreneur_id,)).fetchall()
        profile["services"] = [s["name"] for s in services]

        rating_row = conn.execute("""
            SELECT ROUND(AVG(score), 1) AS avg_rating, COUNT(*) AS rating_count
            FROM ratings WHERE entrepreneur_id = ?
        """, (entrepreneur_id,)).fetchone()
        profile["avg_rating"] = rating_row["avg_rating"]
        profile["rating_count"] = rating_row["rating_count"]

        return profile


def get_photo_fields(entrepreneur_id: int):
    """Returns the stored photo (whichever form it's in) for one entrepreneur by their internal id."""
    with get_connection() as conn:
        row = conn.execute(
            "SELECT photo_file_id, photo_base64 FROM entrepreneurs WHERE id = ?", (entrepreneur_id,)
        ).fetchone()
        return dict(row) if row else None


def get_entrepreneur_profile(telegram_id: int):
    """Fetch one entrepreneur's own profile: services, plus their overall rating stats."""
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

        rating_row = conn.execute("""
            SELECT ROUND(AVG(score), 1) AS avg_rating, COUNT(*) AS rating_count
            FROM ratings WHERE entrepreneur_id = ?
        """, (profile["id"],)).fetchone()
        profile["avg_rating"] = rating_row["avg_rating"]
        profile["rating_count"] = rating_row["rating_count"]

        return profile
