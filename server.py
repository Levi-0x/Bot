"""
server.py
---------
This is what you deploy on Render instead of bot.py directly. It runs
TWO things at once:

  1. The Telegram bot (polling for messages) — in a background thread
  2. A small Flask web server — in the main thread, serving:
       - the Mini App's HTML/CSS/JS files (the folder `webapp/`)
       - a JSON API the Mini App calls to read/write data

Why both live in one process: Render's free "Web Service" tier expects
your app to bind to a network port (the $PORT environment variable) —
that's how Render checks your service is alive. A bot that only polls
Telegram never opens a port, so pairing it with Flask here satisfies
that requirement AND gives us a home for the Mini App.

SETUP (in addition to bot.py's setup):
  1. pip install -r requirements.txt   (now includes Flask)
  2. On Render, set the Start Command to:  python server.py
  3. Set environment variables on Render:
       BOT_TOKEN   = your bot token
       ADMIN_IDS   = your Telegram numeric user ID (comma-separated for multiple)
       WEBAPP_URL  = your Render URL, e.g. https://your-app.onrender.com
     (WEBAPP_URL can only be set correctly AFTER your first deploy, once
      you know the URL Render gave you — redeploy once you have it.)
  4. In BotFather: /mybots -> your bot -> Bot Settings -> Menu Button ->
     set it to your WEBAPP_URL, so users get a menu button that opens
     the app directly (in addition to the /app command).
"""

import os
import time
import hmac
import json
import base64
import hashlib
import logging
import threading
import urllib.request
from urllib.parse import parse_qsl

from flask import Flask, jsonify, request, send_from_directory, Response

import database as db
import bot as bot_module  # reuses build_application(), load_token() from bot.py

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s")
logger = logging.getLogger(__name__)

WEBAPP_DIR = os.path.join(os.path.dirname(__file__), "webapp")
flask_app = Flask(__name__, static_folder=WEBAPP_DIR, static_url_path="")


# ---------- Telegram Mini App authentication ----------
#
# When the Mini App opens, Telegram gives the page a string called
# `initData` containing the user's info, cryptographically signed with
# your bot's token. We MUST verify that signature on every request that
# touches personal data — otherwise anyone could send us a fake
# initData claiming to be any Telegram user they want, and register,
# edit, or delete someone else's listing.
#
# This is the exact algorithm Telegram documents at:
# https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app

def validate_init_data(init_data: str, bot_token: str, max_age_seconds: int = 86400):
    """
    Returns the verified user dict (with at least an 'id') if initData is
    genuinely from Telegram and not expired, or None if it's missing,
    tampered with, or too old.
    """
    if not init_data:
        return None

    try:
        parsed = dict(parse_qsl(init_data, strict_parsing=True))
    except ValueError:
        return None

    received_hash = parsed.pop("hash", None)
    if not received_hash:
        return None

    # Rebuild the exact string Telegram signed: all fields sorted
    # alphabetically, joined as "key=value" pairs with newlines.
    data_check_string = "\n".join(f"{k}={v}" for k, v in sorted(parsed.items()))

    # Telegram's two-step HMAC: first derive a secret key from the bot
    # token, then use THAT to sign the data check string.
    secret_key = hmac.new(b"WebAppData", bot_token.encode(), hashlib.sha256).digest()
    computed_hash = hmac.new(secret_key, data_check_string.encode(), hashlib.sha256).hexdigest()

    # Constant-time comparison prevents timing attacks from leaking the hash
    if not hmac.compare_digest(computed_hash, received_hash):
        return None

    auth_date = int(parsed.get("auth_date", 0))
    if time.time() - auth_date > max_age_seconds:
        return None  # stale session, reject it

    user_json = parsed.get("user")
    if not user_json:
        return None

    return json.loads(user_json)


# ---------- Serving the Mini App itself ----------

@flask_app.route("/")
def index():
    return send_from_directory(WEBAPP_DIR, "index.html")


# ---------- Directory API ----------
# These still require valid Telegram initData, even though the data itself
# is "public" within the app. Without this, anyone on the internet — not
# just people using the Mini App — could script a bot to scrape every
# phone number, email, and photo by iterating IDs or service names. This
# way, a request must genuinely come from someone opening the app inside
# Telegram, which rules out anonymous bulk scraping from outside it.

@flask_app.route("/api/services")
def api_services():
    bot_token = bot_module.load_token()
    if not validate_init_data(request.args.get("initData", ""), bot_token):
        return jsonify({"error": "invalid_init_data"}), 401
    return jsonify(db.get_all_services())


@flask_app.route("/api/top")
def api_top():
    bot_token = bot_module.load_token()
    if not validate_init_data(request.args.get("initData", ""), bot_token):
        return jsonify({"error": "invalid_init_data"}), 401
    limit = request.args.get("limit", default=5, type=int)
    return jsonify(db.get_top_entrepreneurs(limit))


@flask_app.route("/api/entrepreneur/<int:entrepreneur_id>")
def api_entrepreneur_detail(entrepreneur_id):
    bot_token = bot_module.load_token()
    if not validate_init_data(request.args.get("initData", ""), bot_token):
        return jsonify({"error": "invalid_init_data"}), 401
    profile = db.get_public_profile(entrepreneur_id)
    if not profile:
        return jsonify({"error": "not_found"}), 404
    return jsonify(profile)


@flask_app.route("/api/find")
def api_find():
    bot_token = bot_module.load_token()
    if not validate_init_data(request.args.get("initData", ""), bot_token):
        return jsonify({"error": "invalid_init_data"}), 401
    service_query = request.args.get("service", "")
    return jsonify(db.find_by_service(service_query))


# ---------- Authenticated API (requires valid Telegram initData) ----------

@flask_app.route("/api/profile")
def api_profile():
    bot_token = bot_module.load_token()
    user = validate_init_data(request.args.get("initData", ""), bot_token)
    if not user:
        return jsonify({"error": "invalid_init_data"}), 401

    profile = db.get_entrepreneur_profile(user["id"])
    return jsonify(profile)  # null if not registered — the frontend handles that


@flask_app.route("/api/register", methods=["POST"])
def api_register():
    bot_token = bot_module.load_token()
    body = request.get_json(force=True, silent=True) or {}
    user = validate_init_data(body.get("initData", ""), bot_token)
    if not user:
        return jsonify({"error": "invalid_init_data"}), 401

    name = (body.get("name") or "").strip()
    services = body.get("services") or []
    email = (body.get("email") or "").strip()
    photo_base64 = body.get("photo_base64") or ""
    home_address = (body.get("home_address") or "").strip()
    business_address = (body.get("business_address") or "").strip()

    # Phone verification is enforced here too, not just in the Mini App's
    # UI — the "Next" button being disabled client-side is just a nicer
    # experience; this is what actually stops someone from registering
    # with an unverified number, even if they somehow bypassed the UI.
    phone_verification = db.get_phone_verification(user["id"])
    if not phone_verification:
        return jsonify({"error": "phone_not_verified"}), 400

    # Compulsory fields — reject clearly if any are missing, rather than
    # silently saving an incomplete listing. Address logic: a business
    # address covers "where to find you" for shop/office-based entrepreneurs;
    # home address is only required as a fallback for work-from-home
    # entrepreneurs who have no public business address at all.
    missing = []
    if not name: missing.append("name")
    if not services: missing.append("services")
    if "@" not in email or "." not in email.split("@")[-1]: missing.append("email")
    if not photo_base64 and not body.get("keep_existing_photo"): missing.append("photo")
    if not home_address and not business_address: missing.append("business_address_or_home_address")
    if missing:
        return jsonify({"error": "missing_fields", "fields": missing}), 400

    fields = {
        "name": name,
        "socials": (body.get("socials") or "").strip(),
        # phone is NOT taken from the request body — register_entrepreneur
        # always pulls the verified number from phone_verifications itself,
        # so there's no path where an unverified/edited number sneaks in.
        "email": email,
        "business_address": business_address,
        "website": (body.get("website") or "").strip(),
        "home_address": home_address,
    }
    if photo_base64:
        fields["photo_base64"] = photo_base64

    db.register_entrepreneur(user["id"], fields, services)
    return jsonify({"status": "ok"})


@flask_app.route("/api/photo/<int:entrepreneur_id>")
def api_photo(entrepreneur_id):
    """
    Serves an entrepreneur's photo regardless of how it was uploaded:
    - via the Mini App -> stored as a base64 string, decoded and served directly
    - via the bot chat -> stored as a Telegram file_id, so we ask Telegram's
      API for the real file and stream it through (keeps the bot token
      server-side only, never exposed to the browser)
    Requires valid initData too, same reasoning as the other directory endpoints.
    """
    bot_token = bot_module.load_token()
    if not validate_init_data(request.args.get("initData", ""), bot_token):
        return "", 401

    photo = db.get_photo_fields(entrepreneur_id)
    if not photo:
        return "", 404

    if photo["photo_base64"]:
        header, _, encoded = photo["photo_base64"].partition(",")
        content_type = header.split(":")[1].split(";")[0] if ":" in header else "image/jpeg"
        return Response(base64.b64decode(encoded), mimetype=content_type)

    if photo["photo_file_id"]:
        try:
            with urllib.request.urlopen(
                f"https://api.telegram.org/bot{bot_token}/getFile?file_id={photo['photo_file_id']}"
            ) as resp:
                file_info = json.load(resp)
            file_path = file_info["result"]["file_path"]
            with urllib.request.urlopen(
                f"https://api.telegram.org/file/bot{bot_token}/{file_path}"
            ) as resp:
                image_bytes = resp.read()
                content_type = resp.headers.get("Content-Type", "image/jpeg")
            return Response(image_bytes, mimetype=content_type)
        except Exception as e:
            logger.warning(f"Failed to fetch Telegram photo {photo['photo_file_id']}: {e}")
            return "", 404

    return "", 404


@flask_app.route("/api/rate", methods=["POST"])
def api_rate():
    bot_token = bot_module.load_token()
    body = request.get_json(force=True, silent=True) or {}
    user = validate_init_data(body.get("initData", ""), bot_token)
    if not user:
        return jsonify({"error": "invalid_init_data"}), 401

    entrepreneur_id = body.get("entrepreneur_id")
    score = body.get("score")
    comment = (body.get("comment") or "").strip()[:500]  # cap length, this isn't an essay field
    if not isinstance(entrepreneur_id, int) or not isinstance(score, int) or not (1 <= score <= 5):
        return jsonify({"error": "invalid_input"}), 400

    rater_name = user.get("first_name", "Anonymous")
    success = db.rate_entrepreneur_by_id(entrepreneur_id, user["id"], score, comment, rater_name)
    if not success:
        return jsonify({"error": "not_found"}), 404
    return jsonify({"status": "ok"})


@flask_app.route("/api/reviews/<int:entrepreneur_id>")
def api_reviews(entrepreneur_id):
    bot_token = bot_module.load_token()
    if not validate_init_data(request.args.get("initData", ""), bot_token):
        return jsonify({"error": "invalid_init_data"}), 401
    return jsonify(db.get_reviews(entrepreneur_id))


@flask_app.route("/api/unregister", methods=["POST"])
def api_unregister():
    bot_token = bot_module.load_token()
    body = request.get_json(force=True, silent=True) or {}
    user = validate_init_data(body.get("initData", ""), bot_token)
    if not user:
        return jsonify({"error": "invalid_init_data"}), 401

    removed = db.delete_entrepreneur(user["id"])
    return jsonify({"status": "ok", "removed": removed})


# ---------- Admin API (reuses bot.py's ADMIN_IDS logic) ----------

def require_admin(init_data: str, bot_token: str):
    """Returns the verified user dict if they're both a real Telegram user AND an admin, else None."""
    user = validate_init_data(init_data, bot_token)
    if not user:
        return None
    if user["id"] not in bot_module.load_admin_ids():
        return None
    return user


@flask_app.route("/api/admin/check")
def api_admin_check():
    """Lets the frontend quietly check 'is this visitor an admin?' to decide whether to show the Admin Panel menu item."""
    bot_token = bot_module.load_token()
    user = validate_init_data(request.args.get("initData", ""), bot_token)
    is_admin = bool(user and user["id"] in bot_module.load_admin_ids())
    return jsonify({"is_admin": is_admin})


@flask_app.route("/api/admin/stats")
def api_admin_stats():
    bot_token = bot_module.load_token()
    if not require_admin(request.args.get("initData", ""), bot_token):
        return jsonify({"error": "forbidden"}), 403
    return jsonify(db.get_stats())


@flask_app.route("/api/admin/broadcast", methods=["POST"])
def api_admin_broadcast():
    bot_token = bot_module.load_token()
    body = request.get_json(force=True, silent=True) or {}
    if not require_admin(body.get("initData", ""), bot_token):
        return jsonify({"error": "forbidden"}), 403

    message = (body.get("message") or "").strip()
    if not message:
        return jsonify({"error": "empty_message"}), 400

    telegram_ids = db.get_all_telegram_ids()
    sent, failed = 0, 0
    for telegram_id in telegram_ids:
        try:
            payload = json.dumps({
                "chat_id": telegram_id,
                "text": f"📢 Announcement:\n\n{message}",
            }).encode()
            req = urllib.request.Request(
                f"https://api.telegram.org/bot{bot_token}/sendMessage",
                data=payload,
                headers={"Content-Type": "application/json"},
            )
            urllib.request.urlopen(req, timeout=10)
            sent += 1
        except Exception as e:
            # Common reasons: the user blocked the bot, or never started a chat with it.
            logger.warning(f"Broadcast (web) failed for {telegram_id}: {e}")
            failed += 1

    return jsonify({"status": "ok", "sent": sent, "failed": failed})


@flask_app.route("/api/admin/list_admins")
def api_admin_list():
    bot_token = bot_module.load_token()
    if not require_admin(request.args.get("initData", ""), bot_token):
        return jsonify({"error": "forbidden"}), 403

    ids_str = os.environ.get("ADMIN_IDS", "")
    root_ids = sorted({p.strip() for p in ids_str.replace("\n", ",").split(",") if p.strip()})
    db_ids = sorted(db.get_admin_ids_from_db())
    return jsonify({"root_admins": root_ids, "added_admins": db_ids})


@flask_app.route("/api/admin/add_admin", methods=["POST"])
def api_admin_add():
    bot_token = bot_module.load_token()
    body = request.get_json(force=True, silent=True) or {}
    admin_user = require_admin(body.get("initData", ""), bot_token)
    if not admin_user:
        return jsonify({"error": "forbidden"}), 403

    new_admin_id = body.get("telegram_id")
    if not isinstance(new_admin_id, int):
        return jsonify({"error": "invalid_telegram_id"}), 400

    db.add_admin(new_admin_id, added_by=admin_user["id"])
    return jsonify({"status": "ok"})


@flask_app.route("/api/admin/remove_admin", methods=["POST"])
def api_admin_remove():
    bot_token = bot_module.load_token()
    body = request.get_json(force=True, silent=True) or {}
    if not require_admin(body.get("initData", ""), bot_token):
        return jsonify({"error": "forbidden"}), 403

    target_id = body.get("telegram_id")
    if not isinstance(target_id, int):
        return jsonify({"error": "invalid_telegram_id"}), 400

    ids_str = os.environ.get("ADMIN_IDS", "")
    root_ids = {p.strip() for p in ids_str.replace("\n", ",").split(",") if p.strip()}
    if str(target_id) in root_ids:
        return jsonify({"error": "is_root_admin"}), 400  # can't remove via app — only via Render

    removed = db.remove_admin(target_id)
    return jsonify({"status": "ok", "removed": removed})


@flask_app.route("/api/check_phone")
def api_check_phone():
    """
    Polled by the registration form after someone taps 'Verify with
    Telegram' — Telegram delivers the verified number to the BOT chat,
    not directly back to this webpage, so the frontend checks here
    every couple seconds until it shows up.
    """
    bot_token = bot_module.load_token()
    user = validate_init_data(request.args.get("initData", ""), bot_token)
    if not user:
        return jsonify({"error": "invalid_init_data"}), 401

    verification = db.get_phone_verification(user["id"])
    return jsonify({"verified": bool(verification), "phone": verification["phone"] if verification else None})


@flask_app.route("/api/admin/forceremove", methods=["POST"])
def api_admin_forceremove():
    bot_token = bot_module.load_token()
    body = request.get_json(force=True, silent=True) or {}
    if not require_admin(body.get("initData", ""), bot_token):
        return jsonify({"error": "forbidden"}), 403

    name = (body.get("name") or "").strip()
    if not name:
        return jsonify({"error": "missing_name"}), 400

    success, telegram_id = db.force_delete_by_name(name)
    return jsonify({"status": "ok", "removed": success})


# ---------- Running the bot alongside Flask ----------

def run_bot():
    """
    Runs the Telegram bot's polling loop in this background thread.
    stop_signals=None because Python only allows signal handlers
    (Ctrl+C, etc.) to be registered on the MAIN thread — since Flask
    owns the main thread here, the bot can't (and doesn't need to)
    manage OS signals itself.
    """
    # --- Python 3.14 compatibility fix ---
    # Same issue as in bot.py's main(): Python 3.14 no longer auto-creates
    # an event loop. That's true for EVERY thread, not just the main one —
    # so a background thread like this one needs its own explicit fix too.
    import asyncio
    try:
        asyncio.get_event_loop()
    except RuntimeError:
        asyncio.set_event_loop(asyncio.new_event_loop())

    app = bot_module.build_application()
    logger.info("Bot polling started in background thread.")
    app.run_polling(stop_signals=None)


if __name__ == "__main__":
    db.init_db()

    bot_thread = threading.Thread(target=run_bot, daemon=True)
    bot_thread.start()

    port = int(os.environ.get("PORT", 5000))
    logger.info(f"Flask server (Mini App + API) starting on port {port}")
    flask_app.run(host="0.0.0.0", port=port)
