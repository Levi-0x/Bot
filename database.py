"""
database.py — GrowthHub data layer (PostgreSQL)

Migrated from SQLite. Every public function keeps the exact same name,
arguments, and return shape as before, so server.py and bot.py don't
need to change at all — only this file did.

Set the DATABASE_URL environment variable to your Postgres connection
string, e.g.:
    postgresql://user:password@host:5432/dbname
Render's managed Postgres gives you this automatically (look for
"Internal Database URL" on the database's dashboard page) — just add
it as an env var on your web service.
"""

import os
import json
from contextlib import contextmanager

import psycopg2
import psycopg2.errors
from psycopg2.extras import RealDictCursor

# Local fallback so this still runs during development without Render.
# In production, always set DATABASE_URL explicitly.
DATABASE_URL = os.environ.get(
    "DATABASE_URL", "postgresql://postgres:postgres@localhost:5432/entrepreneurs"
)

_SUFFIXES = ["ians", "ing", "ers", "ors", "ian", "ees", "er", "es", "or", "s"]


def _stem(word: str) -> str:
    word = word.lower().strip()
    for suffix in _SUFFIXES:
        if word.endswith(suffix) and len(word) - len(suffix) >= 3:
            return word[: -len(suffix)]
    return word


class _ConnWrapper:
    """
    Thin shim so the rest of this file can keep calling conn.execute(...)
    the same way it did with sqlite3, instead of manually creating a
    cursor every time. Every call gets its own RealDictCursor, whose
    rows behave like dicts (row["col"] and dict(row) both work), just
    like sqlite3.Row did.
    """

    def __init__(self, conn):
        self._conn = conn

    def execute(self, sql, params=()):
        cur = self._conn.cursor(cursor_factory=RealDictCursor)
        cur.execute(sql, params)
        return cur

    def executemany(self, sql, seq_of_params):
        cur = self._conn.cursor()
        cur.executemany(sql, seq_of_params)
        return cur

    def rollback(self):
        self._conn.rollback()


@contextmanager
def get_connection():
    conn = psycopg2.connect(DATABASE_URL)
    try:
        yield _ConnWrapper(conn)
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def init_db():
    with get_connection() as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS entrepreneurs (
                id SERIAL PRIMARY KEY,
                telegram_id BIGINT UNIQUE NOT NULL,
                name TEXT NOT NULL,
                description TEXT DEFAULT '',
                socials TEXT,
                phone TEXT,
                email TEXT,
                photo_file_id TEXT,
                photo_base64 TEXT,
                logo_base64 TEXT,
                cover_base64 TEXT,
                gallery TEXT DEFAULT '[]',
                business_address TEXT,
                website TEXT,
                home_address TEXT,
                business_type TEXT DEFAULT '',
                phone_verified BOOLEAN DEFAULT FALSE,
                identity_verified BOOLEAN DEFAULT FALSE,
                verified_at TIMESTAMPTZ,
                latitude REAL,
                longitude REAL,
                location_captured_at TIMESTAMPTZ,
                social_platforms TEXT DEFAULT '[]',
                created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
            )
        """)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS services (
                id SERIAL PRIMARY KEY,
                name TEXT UNIQUE NOT NULL,
                category TEXT DEFAULT 'service',
                type TEXT DEFAULT 'service',
                description TEXT DEFAULT '',
                price REAL DEFAULT 0,
                delivery_available BOOLEAN DEFAULT FALSE
            )
        """)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS categories (
                id SERIAL PRIMARY KEY,
                name TEXT UNIQUE NOT NULL,
                icon TEXT DEFAULT '',
                color TEXT DEFAULT ''
            )
        """)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS entrepreneur_services (
                entrepreneur_id INTEGER NOT NULL REFERENCES entrepreneurs(id) ON DELETE CASCADE,
                service_id INTEGER NOT NULL REFERENCES services(id) ON DELETE CASCADE,
                PRIMARY KEY (entrepreneur_id, service_id)
            )
        """)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS ratings (
                id SERIAL PRIMARY KEY,
                entrepreneur_id INTEGER NOT NULL REFERENCES entrepreneurs(id) ON DELETE CASCADE,
                rater_telegram_id BIGINT NOT NULL,
                score INTEGER NOT NULL CHECK (score BETWEEN 1 AND 5),
                comment TEXT,
                rater_name TEXT,
                created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
            )
        """)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS phone_verifications (
                telegram_id BIGINT PRIMARY KEY,
                phone TEXT NOT NULL,
                verified_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
            )
        """)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS admins (
                telegram_id BIGINT PRIMARY KEY,
                added_by BIGINT,
                added_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
            )
        """)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS favorites (
                id SERIAL PRIMARY KEY,
                user_telegram_id BIGINT NOT NULL,
                entrepreneur_id INTEGER NOT NULL REFERENCES entrepreneurs(id) ON DELETE CASCADE,
                created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(user_telegram_id, entrepreneur_id)
            )
        """)

        # ---- Migrations ----
        # Postgres supports "ADD COLUMN IF NOT EXISTS" directly, so unlike
        # the old SQLite version we don't need to manually inspect existing
        # columns first — much simpler.
        entrepreneur_migrations = {
            "phone": "TEXT",
            "email": "TEXT",
            "photo_file_id": "TEXT",
            "photo_base64": "TEXT",
            "logo_base64": "TEXT",
            "cover_base64": "TEXT",
            "gallery": "TEXT DEFAULT '[]'",
            "business_address": "TEXT",
            "website": "TEXT",
            "home_address": "TEXT",
            "phone_verified": "BOOLEAN DEFAULT FALSE",
            "identity_verified": "BOOLEAN DEFAULT FALSE",
            "verified_at": "TIMESTAMPTZ",
            "latitude": "REAL",
            "longitude": "REAL",
            "location_captured_at": "TIMESTAMPTZ",
            "social_platforms": "TEXT DEFAULT '[]'",
            "description": "TEXT DEFAULT ''",
            "business_type": "TEXT DEFAULT ''",
            "user_type": "TEXT DEFAULT 'freelancer'",
        }
        for column, col_type in entrepreneur_migrations.items():
            conn.execute(f"ALTER TABLE entrepreneurs ADD COLUMN IF NOT EXISTS {column} {col_type}")

        for column, col_type in {"comment": "TEXT", "rater_name": "TEXT"}.items():
            conn.execute(f"ALTER TABLE ratings ADD COLUMN IF NOT EXISTS {column} {col_type}")

        for column, col_type in {
            "category": "TEXT DEFAULT 'service'",
            "type": "TEXT DEFAULT 'service'",
            "description": "TEXT DEFAULT ''",
            "price": "REAL DEFAULT 0",
            "delivery_available": "BOOLEAN DEFAULT FALSE",
        }.items():
            conn.execute(f"ALTER TABLE services ADD COLUMN IF NOT EXISTS {column} {col_type}")

        # ---- Seed default categories ----
        cat_count = conn.execute("SELECT COUNT(*) AS c FROM categories").fetchone()["c"]
        if cat_count == 0:
            default_categories = [
                ("home services", "\U0001f3e0", "#0F9B8E"),
                ("digital services", "\U0001f4bb", "#4A6FA5"),
                ("creative", "\U0001f3a8", "#FCA311"),
                ("health & wellness", "\U0001f49a", "#2ECC71"),
                ("education", "\U0001f4da", "#9B59B6"),
                ("food & catering", "\U0001f37d", "#E74C3C"),
                ("transport", "\U0001f697", "#3498DB"),
                ("fashion & beauty", "\U0001f457", "#E91E63"),
                ("repair & maintenance", "\U0001f527", "#F39C12"),
                ("other", "\U0001f4e6", "#95A5A6"),
            ]
            conn.executemany(
                "INSERT INTO categories (name, icon, color) VALUES (%s, %s, %s) ON CONFLICT (name) DO NOTHING",
                default_categories,
            )


# ---------- Entrepreneur registration ----------

def register_entrepreneur(telegram_id: int, fields: dict, service_names: list[str]):
    allowed_columns = {
        "name", "socials", "phone", "email", "photo_file_id", "photo_base64",
        "logo_base64", "cover_base64", "gallery",
        "business_address", "website", "home_address",
        "phone_verified", "social_platforms", "description", "business_type",
        "user_type",
    }
    fields = {k: v for k, v in fields.items() if k in allowed_columns}

    with get_connection() as conn:
        verified = conn.execute(
            "SELECT phone FROM phone_verifications WHERE telegram_id = %s", (telegram_id,)
        ).fetchone()
        if verified:
            fields["phone"] = verified["phone"]
            fields["phone_verified"] = True

        existing = conn.execute(
            "SELECT id FROM entrepreneurs WHERE telegram_id = %s", (telegram_id,)
        ).fetchone()

        if existing:
            set_clause = ", ".join(f"{col} = %s" for col in fields)
            conn.execute(
                f"UPDATE entrepreneurs SET {set_clause} WHERE telegram_id = %s",
                (*fields.values(), telegram_id)
            )
            entrepreneur_id = existing["id"]
        else:
            columns = ", ".join(fields.keys())
            placeholders = ", ".join("%s" for _ in fields)
            cursor = conn.execute(
                f"INSERT INTO entrepreneurs (telegram_id, {columns}) VALUES (%s, {placeholders}) RETURNING id",
                (telegram_id, *fields.values())
            )
            entrepreneur_id = cursor.fetchone()["id"]

        conn.execute("DELETE FROM entrepreneur_services WHERE entrepreneur_id = %s", (entrepreneur_id,))

        for raw_name in service_names:
            service_name = raw_name.strip().lower()
            if not service_name:
                continue
            conn.execute(
                "INSERT INTO services (name) VALUES (%s) ON CONFLICT (name) DO NOTHING", (service_name,)
            )
            service_id = conn.execute(
                "SELECT id FROM services WHERE name = %s", (service_name,)
            ).fetchone()["id"]
            conn.execute(
                "INSERT INTO entrepreneur_services (entrepreneur_id, service_id) VALUES (%s, %s) "
                "ON CONFLICT (entrepreneur_id, service_id) DO NOTHING",
                (entrepreneur_id, service_id)
            )

    return entrepreneur_id


# ---------- Searching ----------

def _base_entrepreneur_query():
    return """
        SELECT
            e.id, e.name, e.description, e.socials, e.social_platforms,
            e.phone, e.email, e.business_address, e.website,
            e.photo_file_id, e.photo_base64, e.logo_base64, e.cover_base64,
            e.gallery, e.business_type, e.user_type, e.phone_verified, e.created_at,
            STRING_AGG(DISTINCT s.name, ',') AS services_csv,
            ROUND(AVG(r.score), 1) AS avg_rating,
            COUNT(DISTINCT r.id) AS rating_count
        FROM entrepreneurs e
        LEFT JOIN entrepreneur_services es ON es.entrepreneur_id = e.id
        LEFT JOIN services s ON s.id = es.service_id
        LEFT JOIN ratings r ON r.entrepreneur_id = e.id
    """


def _row_to_dict(row):
    d = dict(row)
    if "services_csv" in d:
        d["services"] = d["services_csv"].split(",") if d["services_csv"] else []
        del d["services_csv"]
    if d.get("gallery"):
        try:
            d["gallery"] = json.loads(d["gallery"])
        except Exception:
            d["gallery"] = []
    else:
        d["gallery"] = []
    if d.get("social_platforms"):
        try:
            parsed = json.loads(d["social_platforms"])
            d["social_platforms"] = parsed if isinstance(parsed, list) else []
        except Exception:
            d["social_platforms"] = []
    else:
        d["social_platforms"] = []
    return d


def get_top_entrepreneurs(limit: int = 5):
    with get_connection() as conn:
        rows = conn.execute(f"""
            {_base_entrepreneur_query()}
            GROUP BY e.id
            ORDER BY avg_rating DESC NULLS LAST, rating_count DESC
            LIMIT %s
        """, (limit,)).fetchall()
        return [_row_to_dict(row) for row in rows]


def get_recent_entrepreneurs(limit: int = 10):
    with get_connection() as conn:
        rows = conn.execute(f"""
            {_base_entrepreneur_query()}
            GROUP BY e.id
            ORDER BY e.created_at DESC
            LIMIT %s
        """, (limit,)).fetchall()
        return [_row_to_dict(row) for row in rows]


def get_featured_entrepreneurs(limit: int = 10):
    with get_connection() as conn:
        rows = conn.execute(f"""
            {_base_entrepreneur_query()}
            GROUP BY e.id
            HAVING AVG(r.score) >= 4.0 AND COUNT(DISTINCT r.id) >= 3
            ORDER BY rating_count DESC, avg_rating DESC
            LIMIT %s
        """, (limit,)).fetchall()
        return [_row_to_dict(row) for row in rows]


def get_all_services():
    with get_connection() as conn:
        rows = conn.execute("""
            SELECT s.name, s.category, s.type, s.description, s.price, s.delivery_available,
                   COUNT(es.entrepreneur_id) AS entrepreneur_count
            FROM services s
            JOIN entrepreneur_services es ON es.service_id = s.id
            GROUP BY s.id
            ORDER BY s.category ASC, s.name ASC
        """).fetchall()
        return [dict(row) for row in rows]


def get_categories():
    with get_connection() as conn:
        rows = conn.execute("SELECT * FROM categories ORDER BY name ASC").fetchall()
        return [dict(row) for row in rows]


def get_services_by_category(category: str):
    with get_connection() as conn:
        rows = conn.execute("""
            SELECT s.name, s.category, s.type, COUNT(es.entrepreneur_id) AS entrepreneur_count
            FROM services s
            JOIN entrepreneur_services es ON es.service_id = s.id
            WHERE s.category = %s
            GROUP BY s.id
            ORDER BY s.name ASC
        """, (category,)).fetchall()
        return [dict(row) for row in rows]


def find_by_service(query: str, category: str = "", service_type: str = ""):
    query_stem = _stem(query)
    query_lower = query.strip().lower()

    with get_connection() as conn:
        all_services = [dict(row) for row in conn.execute("SELECT name, category, type FROM services").fetchall()]
        matching_services = [
            s["name"] for s in all_services
            if (query_lower in s["name"].lower()
                or query_stem in _stem(s["name"])
                or _stem(s["name"]) in query_stem)
            and (not category or s.get("category", "service") == category)
            and (not service_type or s.get("type", "service") == service_type)
        ]

        matching_ids = set()

        if matching_services:
            placeholders = ",".join("%s" for _ in matching_services)
            rows = conn.execute(f"""
                SELECT DISTINCT es.entrepreneur_id FROM entrepreneur_services es
                JOIN services s ON s.id = es.service_id
                WHERE s.name IN ({placeholders})
            """, matching_services).fetchall()
            matching_ids |= {row["entrepreneur_id"] for row in rows}

        name_or_address_rows = conn.execute("""
            SELECT id FROM entrepreneurs WHERE LOWER(name) LIKE LOWER(%s) OR LOWER(business_address) LIKE LOWER(%s) OR LOWER(description) LIKE LOWER(%s)
        """, (f"%{query_lower}%", f"%{query_lower}%", f"%{query_lower}%")).fetchall()
        matching_ids |= {row["id"] for row in name_or_address_rows}

        if not matching_ids:
            return []

        placeholders = ",".join("%s" for _ in matching_ids)
        rows = conn.execute(f"""
            {_base_entrepreneur_query()}
            WHERE e.id IN ({placeholders})
            GROUP BY e.id
            ORDER BY avg_rating DESC NULLS LAST, rating_count DESC
        """, list(matching_ids)).fetchall()

        return [_row_to_dict(row) for row in rows]


# ---------- Ratings ----------

def rate_entrepreneur_by_id(entrepreneur_id: int, rater_telegram_id: int, score: int, comment: str = "", rater_name: str = ""):
    with get_connection() as conn:
        match = conn.execute(
            "SELECT id FROM entrepreneurs WHERE id = %s", (entrepreneur_id,)
        ).fetchone()
        if not match:
            return False

        existing = conn.execute(
            "SELECT id FROM ratings WHERE entrepreneur_id = %s AND rater_telegram_id = %s",
            (entrepreneur_id, rater_telegram_id)
        ).fetchone()

        if existing:
            conn.execute(
                "UPDATE ratings SET score = %s, comment = %s, rater_name = %s, created_at = CURRENT_TIMESTAMP WHERE id = %s",
                (score, comment, rater_name, existing["id"])
            )
        else:
            conn.execute(
                "INSERT INTO ratings (entrepreneur_id, rater_telegram_id, score, comment, rater_name) VALUES (%s, %s, %s, %s, %s)",
                (entrepreneur_id, rater_telegram_id, score, comment, rater_name)
            )
        return True


def get_reviews(entrepreneur_id: int, limit: int = 50):
    with get_connection() as conn:
        rows = conn.execute("""
            SELECT score, comment, rater_name, created_at
            FROM ratings
            WHERE entrepreneur_id = %s
            ORDER BY created_at DESC
            LIMIT %s
        """, (entrepreneur_id, limit)).fetchall()
        return [dict(row) for row in rows]


def rate_entrepreneur(name: str, rater_telegram_id: int, score: int):
    with get_connection() as conn:
        match = conn.execute(
            "SELECT id, name FROM entrepreneurs WHERE name LIKE %s", (f"%{name.strip()}%",)
        ).fetchone()
        if not match:
            return False, f'No entrepreneur found matching "{name}".'
        conn.execute(
            "INSERT INTO ratings (entrepreneur_id, rater_telegram_id, score) VALUES (%s, %s, %s)",
            (match["id"], rater_telegram_id, score)
        )
        return True, f'Rated {match["name"]} {score}/5.'


# ---------- Favorites ----------

def add_favorite(user_telegram_id: int, entrepreneur_id: int):
    with get_connection() as conn:
        try:
            conn.execute(
                "INSERT INTO favorites (user_telegram_id, entrepreneur_id) VALUES (%s, %s)",
                (user_telegram_id, entrepreneur_id)
            )
            return True
        except Exception:
            return False


# ---------- Customer helpers ----------

def get_user_type(telegram_id: int):
    with get_connection() as conn:
        row = conn.execute(
            "SELECT user_type FROM entrepreneurs WHERE telegram_id = %s", (telegram_id,)
        ).fetchone()
        return row["user_type"] if row else None


def count_reviews_written(telegram_id: int):
    with get_connection() as conn:
        row = conn.execute(
            "SELECT COUNT(*) AS cnt FROM ratings WHERE rater_telegram_id = %s", (telegram_id,)
        ).fetchone()
        return row["cnt"] if row else 0


def count_favorites(telegram_id: int):
    with get_connection() as conn:
        row = conn.execute(
            "SELECT COUNT(*) AS cnt FROM favorites WHERE user_telegram_id = %s", (telegram_id,)
        ).fetchone()
        return row["cnt"] if row else 0


def upgrade_to_freelancer(telegram_id: int):
    with get_connection() as conn:
        conn.execute(
            "UPDATE entrepreneurs SET user_type = 'freelancer' WHERE telegram_id = %s", (telegram_id,)
        )
    return True


def remove_favorite(user_telegram_id: int, entrepreneur_id: int):
    with get_connection() as conn:
        cursor = conn.execute(
            "DELETE FROM favorites WHERE user_telegram_id = %s AND entrepreneur_id = %s",
            (user_telegram_id, entrepreneur_id)
        )
        return cursor.rowcount > 0


def is_favorited(user_telegram_id: int, entrepreneur_id: int):
    with get_connection() as conn:
        row = conn.execute(
            "SELECT id FROM favorites WHERE user_telegram_id = %s AND entrepreneur_id = %s",
            (user_telegram_id, entrepreneur_id)
        ).fetchone()
        return bool(row)


def get_favorites(user_telegram_id: int):
    with get_connection() as conn:
        rows = conn.execute(f"""
            {_base_entrepreneur_query()}
            JOIN favorites f ON f.entrepreneur_id = e.id
            WHERE f.user_telegram_id = %s
            GROUP BY e.id, f.created_at
            ORDER BY f.created_at DESC
        """, (user_telegram_id,)).fetchall()
        return [_row_to_dict(row) for row in rows]


# ---------- Admin ----------

def get_admin_ids_from_db():
    with get_connection() as conn:
        rows = conn.execute("SELECT telegram_id FROM admins").fetchall()
        return {row["telegram_id"] for row in rows}


def add_admin(telegram_id: int, added_by: int):
    with get_connection() as conn:
        conn.execute(
            "INSERT INTO admins (telegram_id, added_by) VALUES (%s, %s) ON CONFLICT (telegram_id) DO NOTHING",
            (telegram_id, added_by)
        )


def remove_admin(telegram_id: int):
    with get_connection() as conn:
        cursor = conn.execute("DELETE FROM admins WHERE telegram_id = %s", (telegram_id,))
        return cursor.rowcount > 0


# ---------- Phone verification ----------

def set_verified_phone(telegram_id: int, phone: str):
    with get_connection() as conn:
        conn.execute("""
            INSERT INTO phone_verifications (telegram_id, phone, verified_at)
            VALUES (%s, %s, CURRENT_TIMESTAMP)
            ON CONFLICT (telegram_id) DO UPDATE SET phone = EXCLUDED.phone, verified_at = CURRENT_TIMESTAMP
        """, (telegram_id, phone))
        conn.execute(
            "UPDATE entrepreneurs SET phone = %s, phone_verified = %s WHERE telegram_id = %s",
            (phone, True, telegram_id)
        )


def get_phone_verification(telegram_id: int):
    with get_connection() as conn:
        row = conn.execute(
            "SELECT phone, verified_at FROM phone_verifications WHERE telegram_id = %s", (telegram_id,)
        ).fetchone()
        return dict(row) if row else None


# ---------- Stats ----------

def get_stats():
    with get_connection() as conn:
        entrepreneurs = conn.execute("SELECT COUNT(*) AS c FROM entrepreneurs").fetchone()["c"]
        services = conn.execute("SELECT COUNT(*) AS c FROM services").fetchone()["c"]
        ratings = conn.execute("SELECT COUNT(*) AS c FROM ratings").fetchone()["c"]
        return {"entrepreneurs": entrepreneurs, "services": services, "ratings": ratings}


def get_all_telegram_ids():
    with get_connection() as conn:
        rows = conn.execute("SELECT telegram_id FROM entrepreneurs").fetchall()
        return [row["telegram_id"] for row in rows]


# ---------- Profile management ----------

def get_public_profile(entrepreneur_id: int):
    with get_connection() as conn:
        row = conn.execute("""
            SELECT id, name, description, socials, social_platforms, phone, email,
                   business_address, website, photo_file_id, photo_base64,
                   logo_base64, cover_base64, gallery, business_type, user_type,
                   created_at, phone_verified
            FROM entrepreneurs WHERE id = %s
        """, (entrepreneur_id,)).fetchone()
        if not row:
            return None
        profile = _row_to_dict(row)
        services = conn.execute("""
            SELECT s.name, s.type, s.description, s.price, s.delivery_available
            FROM services s
            JOIN entrepreneur_services es ON es.service_id = s.id
            WHERE es.entrepreneur_id = %s
        """, (entrepreneur_id,)).fetchall()
        profile["services"] = [dict(s) for s in services]
        rating_row = conn.execute("""
            SELECT ROUND(AVG(score), 1) AS avg_rating, COUNT(*) AS rating_count
            FROM ratings WHERE entrepreneur_id = %s
        """, (entrepreneur_id,)).fetchone()
        profile["avg_rating"] = rating_row["avg_rating"]
        profile["rating_count"] = rating_row["rating_count"]
        return profile


def get_photo_fields(entrepreneur_id: int):
    with get_connection() as conn:
        row = conn.execute(
            "SELECT photo_file_id, photo_base64 FROM entrepreneurs WHERE id = %s", (entrepreneur_id,)
        ).fetchone()
        return dict(row) if row else None


def get_entrepreneur_profile(telegram_id: int):
    with get_connection() as conn:
        row = conn.execute(
            "SELECT * FROM entrepreneurs WHERE telegram_id = %s", (telegram_id,)
        ).fetchone()
        if not row:
            return None
        profile = _row_to_dict(row)
        services = conn.execute("""
            SELECT s.name, s.type, s.description, s.price, s.delivery_available
            FROM services s
            JOIN entrepreneur_services es ON es.service_id = s.id
            WHERE es.entrepreneur_id = %s
        """, (profile["id"],)).fetchall()
        profile["services"] = [dict(s) for s in services]
        rating_row = conn.execute("""
            SELECT ROUND(AVG(score), 1) AS avg_rating, COUNT(*) AS rating_count
            FROM ratings WHERE entrepreneur_id = %s
        """, (profile["id"],)).fetchone()
        profile["avg_rating"] = rating_row["avg_rating"]
        profile["rating_count"] = rating_row["rating_count"]
        return profile


def force_delete_by_name(name: str):
    with get_connection() as conn:
        match = conn.execute(
            "SELECT telegram_id FROM entrepreneurs WHERE name LIKE %s", (f"%{name.strip()}%",)
        ).fetchone()
        if not match:
            return False, None
        conn.execute("DELETE FROM entrepreneurs WHERE telegram_id = %s", (match["telegram_id"],))
        return True, match["telegram_id"]


def delete_entrepreneur(telegram_id: int):
    with get_connection() as conn:
        cursor = conn.execute(
            "DELETE FROM entrepreneurs WHERE telegram_id = %s", (telegram_id,)
        )
        conn.execute(
            "DELETE FROM favorites WHERE user_telegram_id = %s",
            (telegram_id,)
        )
        conn.execute(
            "DELETE FROM phone_verifications WHERE telegram_id = %s",
            (telegram_id,)
        )
        return cursor.rowcount > 0


def add_services(telegram_id: int, service_names: list[str]):
    with get_connection() as conn:
        row = conn.execute(
            "SELECT id FROM entrepreneurs WHERE telegram_id = %s", (telegram_id,)
        ).fetchone()
        if not row:
            return False
        entrepreneur_id = row["id"]
        for raw_name in service_names:
            service_name = raw_name.strip().lower()
            if not service_name:
                continue
            conn.execute(
                "INSERT INTO services (name) VALUES (%s) ON CONFLICT (name) DO NOTHING", (service_name,)
            )
            service_id = conn.execute(
                "SELECT id FROM services WHERE name = %s", (service_name,)
            ).fetchone()["id"]
            conn.execute(
                "INSERT INTO entrepreneur_services (entrepreneur_id, service_id) VALUES (%s, %s) "
                "ON CONFLICT (entrepreneur_id, service_id) DO NOTHING",
                (entrepreneur_id, service_id)
            )
        return True


def remove_services(telegram_id: int, service_names: list[str]):
    with get_connection() as conn:
        row = conn.execute(
            "SELECT id FROM entrepreneurs WHERE telegram_id = %s", (telegram_id,)
        ).fetchone()
        if not row:
            return False
        entrepreneur_id = row["id"]
        for raw_name in service_names:
            service_name = raw_name.strip().lower()
            if not service_name:
                continue
            service_row = conn.execute(
                "SELECT id FROM services WHERE name = %s", (service_name,)
            ).fetchone()
            if service_row:
                conn.execute(
                    "DELETE FROM entrepreneur_services WHERE entrepreneur_id = %s AND service_id = %s",
                    (entrepreneur_id, service_row["id"])
                )
        return True
