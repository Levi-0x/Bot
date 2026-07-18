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
import hashlib
import logging
import threading
from urllib.parse import parse_qsl

from flask import Flask, jsonify, request, send_from_directory

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


# ---------- Public read API (no auth needed — this is just the public directory) ----------

@flask_app.route("/api/services")
def api_services():
    return jsonify(db.get_all_services())


@flask_app.route("/api/find")
def api_find():
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
    socials = (body.get("socials") or "").strip()
    services = body.get("services") or []

    if not name or not services:
        return jsonify({"error": "missing_fields"}), 400

    db.register_entrepreneur(user["id"], name, socials, services)
    return jsonify({"status": "ok"})


@flask_app.route("/api/unregister", methods=["POST"])
def api_unregister():
    bot_token = bot_module.load_token()
    body = request.get_json(force=True, silent=True) or {}
    user = validate_init_data(body.get("initData", ""), bot_token)
    if not user:
        return jsonify({"error": "invalid_init_data"}), 401

    removed = db.delete_entrepreneur(user["id"])
    return jsonify({"status": "ok", "removed": removed})


# ---------- Running the bot alongside Flask ----------

def run_bot():
    """
    Runs the Telegram bot's polling loop in this background thread.
    stop_signals=None because Python only allows signal handlers
    (Ctrl+C, etc.) to be registered on the MAIN thread — since Flask
    owns the main thread here, the bot can't (and doesn't need to)
    manage OS signals itself.
    """
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
