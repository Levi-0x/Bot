"""
server.py — GrowthHub Flask API + Telegram bot
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
import bot as bot_module

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s")
logger = logging.getLogger(__name__)

WEBAPP_DIR = os.path.join(os.path.dirname(__file__), "webapp")
flask_app = Flask(__name__, static_folder=WEBAPP_DIR, static_url_path="")


def validate_init_data(init_data: str, bot_token: str, max_age_seconds: int = 86400):
    if not init_data:
        return None
    try:
        parsed = dict(parse_qsl(init_data, strict_parsing=True))
    except ValueError:
        return None
    received_hash = parsed.pop("hash", None)
    if not received_hash:
        return None
    data_check_string = "\n".join(f"{k}={v}" for k, v in sorted(parsed.items()))
    secret_key = hmac.new(b"WebAppData", bot_token.encode(), hashlib.sha256).digest()
    computed_hash = hmac.new(secret_key, data_check_string.encode(), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(computed_hash, received_hash):
        return None
    auth_date = int(parsed.get("auth_date", 0))
    if time.time() - auth_date > max_age_seconds:
        return None
    user_json = parsed.get("user")
    if not user_json:
        return None
    return json.loads(user_json)


# ---------- Serving the Mini App ----------

@flask_app.route("/")
def index():
    return send_from_directory(WEBAPP_DIR, "index.html")


# ---------- Public directory API ----------

@flask_app.route("/api/services")
def api_services():
    bot_token = bot_module.load_token()
    if not validate_init_data(request.args.get("initData", ""), bot_token):
        return jsonify({"error": "invalid_init_data"}), 401
    category = request.args.get("category", "")
    if category:
        return jsonify(db.get_services_by_category(category))
    return jsonify(db.get_all_services())


@flask_app.route("/api/categories")
def api_categories():
    bot_token = bot_module.load_token()
    if not validate_init_data(request.args.get("initData", ""), bot_token):
        return jsonify({"error": "invalid_init_data"}), 401
    return jsonify(db.get_categories())


@flask_app.route("/api/top")
def api_top():
    bot_token = bot_module.load_token()
    if not validate_init_data(request.args.get("initData", ""), bot_token):
        return jsonify({"error": "invalid_init_data"}), 401
    limit = request.args.get("limit", default=5, type=int)
    return jsonify(db.get_top_entrepreneurs(limit))


@flask_app.route("/api/recent")
def api_recent():
    bot_token = bot_module.load_token()
    if not validate_init_data(request.args.get("initData", ""), bot_token):
        return jsonify({"error": "invalid_init_data"}), 401
    limit = request.args.get("limit", default=10, type=int)
    return jsonify(db.get_recent_entrepreneurs(limit))


@flask_app.route("/api/featured")
def api_featured():
    bot_token = bot_module.load_token()
    if not validate_init_data(request.args.get("initData", ""), bot_token):
        return jsonify({"error": "invalid_init_data"}), 401
    limit = request.args.get("limit", default=10, type=int)
    return jsonify(db.get_featured_entrepreneurs(limit))


@flask_app.route("/api/entrepreneur/<int:entrepreneur_id>")
def api_entrepreneur_detail(entrepreneur_id):
    bot_token = bot_module.load_token()
    if not validate_init_data(request.args.get("initData", ""), bot_token):
        return jsonify({"error": "invalid_init_data"}), 401
    profile = db.get_public_profile(entrepreneur_id)
    if not profile:
        return jsonify({"error": "not_found"}), 404
    user = validate_init_data(request.args.get("initData", ""), bot_token)
    if user:
        profile["is_favorited"] = db.is_favorited(user["id"], entrepreneur_id)
    return jsonify(profile)


@flask_app.route("/api/find")
def api_find():
    bot_token = bot_module.load_token()
    user = validate_init_data(request.args.get("initData", ""), bot_token)
    if not user:
        return jsonify({"error": "invalid_init_data"}), 401
    service_query = request.args.get("service", "")
    category = request.args.get("category", "")
    service_type = request.args.get("type", "")
    lat = request.args.get("lat", type=float)
    lng = request.args.get("lng", type=float)
    max_distance = request.args.get("max_distance", type=float)
    limit = request.args.get("limit", 20, type=int)
    offset = request.args.get("offset", 0, type=int)
    result = db.find_by_service(service_query, category=category, service_type=service_type, lat=lat, lng=lng, max_distance_km=max_distance, limit=limit, offset=offset)
    if service_query:
        db.log_search(service_query, result.get("total", 0), user["id"])
    return jsonify(result)


# ---------- Authenticated API ----------

@flask_app.route("/api/profile")
def api_profile():
    bot_token = bot_module.load_token()
    user = validate_init_data(request.args.get("initData", ""), bot_token)
    if not user:
        return jsonify({"error": "invalid_init_data"}), 401
    profile = db.get_entrepreneur_profile(user["id"])
    if profile:
        profile["reviews_written"] = db.count_reviews_written(user["id"])
        profile["favorites_count"] = db.count_favorites(user["id"])
    return jsonify(profile)


@flask_app.route("/api/upgrade_to_freelancer", methods=["POST"])
def api_upgrade_to_freelancer():
    bot_token = bot_module.load_token()
    body = request.get_json(force=True, silent=True) or {}
    user = validate_init_data(body.get("initData", ""), bot_token)
    if not user:
        return jsonify({"error": "invalid_init_data"}), 401
    db.upgrade_to_freelancer(user["id"])
    return jsonify({"status": "ok"})


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
    user_type = (body.get("user_type") or "freelancer").strip()
    if user_type not in ("customer", "freelancer"):
        user_type = "freelancer"

    phone_verification = db.get_phone_verification(user["id"])
    if not phone_verification:
        return jsonify({"error": "phone_not_verified"}), 400

    import re as _re

    if user_type == "customer":
        missing = []
        if not name:
            missing.append("name")
        if not _re.match(r'^[^@\s]+@[^@\s]+\.[^@\s]+$', email):
            missing.append("email")
        if not photo_base64 and not body.get("keep_existing_photo"):
            missing.append("photo")
        if missing:
            return jsonify({"error": "missing_fields", "fields": missing}), 400

        fields = {
            "name": name,
            "email": email,
            "user_type": "customer",
        }
        if photo_base64:
            fields["photo_base64"] = photo_base64
    else:
        missing = []
        if not name:
            missing.append("name")
        if not services:
            missing.append("services")
        if not _re.match(r'^[^@\s]+@[^@\s]+\.[^@\s]+$', email):
            missing.append("email")
        if not photo_base64 and not body.get("keep_existing_photo"):
            missing.append("photo")
        if not home_address and not business_address:
            missing.append("business_address_or_home_address")
        if missing:
            return jsonify({"error": "missing_fields", "fields": missing}), 400

        fields = {
            "name": name,
            "email": email,
            "business_address": business_address,
            "website": (body.get("website") or "").strip(),
            "home_address": home_address,
            "description": (body.get("description") or "").strip()[:500],
            "business_type": (body.get("business_type") or "").strip(),
            "user_type": "freelancer",
        }
        social_platforms = body.get("social_platforms")
        if social_platforms is not None:
            if isinstance(social_platforms, list):
                fields["social_platforms"] = json.dumps(social_platforms)
            elif isinstance(social_platforms, str):
                fields["social_platforms"] = social_platforms
        if photo_base64:
            fields["photo_base64"] = photo_base64
        gallery = body.get("gallery")
        if gallery is not None and isinstance(gallery, list):
            fields["gallery"] = json.dumps(gallery)

    lat = body.get("lat")
    lng = body.get("lng")
    if lat is not None and lng is not None:
        import datetime
        try:
            fields["latitude"] = float(lat)
            fields["longitude"] = float(lng)
            fields["location_captured_at"] = datetime.datetime.utcnow()
        except (ValueError, TypeError):
            pass

    if user.get("username"):
        fields["telegram_username"] = user["username"]

    db.register_entrepreneur(user["id"], fields, services if user_type == "freelancer" else [])
    return jsonify({"status": "ok"})


@flask_app.route("/api/photo/<int:entrepreneur_id>")
def api_photo(entrepreneur_id):
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
    comment = (body.get("comment") or "").strip()[:500]
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


# ---------- Favorites API ----------

@flask_app.route("/api/favorites", methods=["GET"])
def api_get_favorites():
    bot_token = bot_module.load_token()
    user = validate_init_data(request.args.get("initData", ""), bot_token)
    if not user:
        return jsonify({"error": "invalid_init_data"}), 401
    return jsonify(db.get_favorites(user["id"]))


@flask_app.route("/api/favorites/add", methods=["POST"])
def api_add_favorite():
    bot_token = bot_module.load_token()
    body = request.get_json(force=True, silent=True) or {}
    user = validate_init_data(body.get("initData", ""), bot_token)
    if not user:
        return jsonify({"error": "invalid_init_data"}), 401
    entrepreneur_id = body.get("entrepreneur_id")
    if not isinstance(entrepreneur_id, int):
        return jsonify({"error": "invalid_input"}), 400
    db.add_favorite(user["id"], entrepreneur_id)
    return jsonify({"status": "ok"})


@flask_app.route("/api/favorites/remove", methods=["POST"])
def api_remove_favorite():
    bot_token = bot_module.load_token()
    body = request.get_json(force=True, silent=True) or {}
    user = validate_init_data(body.get("initData", ""), bot_token)
    if not user:
        return jsonify({"error": "invalid_init_data"}), 401
    entrepreneur_id = body.get("entrepreneur_id")
    if not isinstance(entrepreneur_id, int):
        return jsonify({"error": "invalid_input"}), 400
    db.remove_favorite(user["id"], entrepreneur_id)
    return jsonify({"status": "ok"})


@flask_app.route("/api/check_phone")
def api_check_phone():
    bot_token = bot_module.load_token()
    user = validate_init_data(request.args.get("initData", ""), bot_token)
    if not user:
        return jsonify({"error": "invalid_init_data"}), 401
    verification = db.get_phone_verification(user["id"])
    return jsonify({"verified": bool(verification), "phone": verification["phone"] if verification else None})


# ---------- Admin API ----------

def require_admin(init_data: str, bot_token: str):
    user = validate_init_data(init_data, bot_token)
    if not user:
        return None
    if user["id"] not in bot_module.load_admin_ids():
        return None
    return user


@flask_app.route("/api/admin/check")
def api_admin_check():
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
    admin_user = require_admin(body.get("initData", ""), bot_token)
    if not admin_user:
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
                "text": f"\U0001f4e2 Announcement:\n\n{message}",
            }).encode()
            req = urllib.request.Request(
                f"https://api.telegram.org/bot{bot_token}/sendMessage",
                data=payload,
                headers={"Content-Type": "application/json"},
            )
            urllib.request.urlopen(req, timeout=10)
            sent += 1
        except Exception as e:
            logger.warning(f"Broadcast (web) failed for {telegram_id}: {e}")
            failed += 1
    db.log_admin_action(admin_user["id"], "broadcast", details=f"sent={sent} failed={failed}")
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
    db.log_admin_action(admin_user["id"], "add_admin", target_type="user", target_id=str(new_admin_id))
    return jsonify({"status": "ok"})


@flask_app.route("/api/admin/remove_admin", methods=["POST"])
def api_admin_remove():
    bot_token = bot_module.load_token()
    body = request.get_json(force=True, silent=True) or {}
    admin_user = require_admin(body.get("initData", ""), bot_token)
    if not admin_user:
        return jsonify({"error": "forbidden"}), 403
    target_id = body.get("telegram_id")
    if not isinstance(target_id, int):
        return jsonify({"error": "invalid_telegram_id"}), 400
    ids_str = os.environ.get("ADMIN_IDS", "")
    root_ids = {p.strip() for p in ids_str.replace("\n", ",").split(",") if p.strip()}
    if str(target_id) in root_ids:
        return jsonify({"error": "is_root_admin"}), 400
    removed = db.remove_admin(target_id)
    db.log_admin_action(admin_user["id"], "remove_admin", target_type="user", target_id=str(target_id))
    return jsonify({"status": "ok", "removed": removed})


@flask_app.route("/api/admin/forceremove", methods=["POST"])
def api_admin_forceremove():
    bot_token = bot_module.load_token()
    body = request.get_json(force=True, silent=True) or {}
    admin_user = require_admin(body.get("initData", ""), bot_token)
    if not admin_user:
        return jsonify({"error": "forbidden"}), 403
    name = (body.get("name") or "").strip()
    if not name:
        return jsonify({"error": "missing_name"}), 400
    success, telegram_id = db.force_delete_by_name(name)
    db.log_admin_action(admin_user["id"], "force_remove", target_type="listing", target_id=name, details=f"removed={success}")
    return jsonify({"status": "ok", "removed": success})


@flask_app.route("/api/admin/reviews/<int:review_id>", methods=["DELETE"])
def api_admin_delete_review(review_id):
    bot_token = bot_module.load_token()
    body = request.get_json(force=True, silent=True) or {}
    admin_user = require_admin(body.get("initData", ""), bot_token)
    if not admin_user:
        return jsonify({"error": "forbidden"}), 403
    deleted = db.delete_review(review_id)
    db.log_admin_action(admin_user["id"], "delete_review", target_type="review", target_id=str(review_id))
    return jsonify({"status": "ok", "deleted": deleted})


@flask_app.route("/api/admin/reviews/<int:review_id>/hide", methods=["PATCH"])
def api_admin_hide_review(review_id):
    bot_token = bot_module.load_token()
    body = request.get_json(force=True, silent=True) or {}
    admin_user = require_admin(body.get("initData", ""), bot_token)
    if not admin_user:
        return jsonify({"error": "forbidden"}), 403
    hidden = db.hide_review(review_id)
    db.log_admin_action(admin_user["id"], "hide_review", target_type="review", target_id=str(review_id))
    return jsonify({"status": "ok", "hidden": hidden})


@flask_app.route("/api/admin/reviews/<int:review_id>/unhide", methods=["PATCH"])
def api_admin_unhide_review(review_id):
    bot_token = bot_module.load_token()
    body = request.get_json(force=True, silent=True) or {}
    admin_user = require_admin(body.get("initData", ""), bot_token)
    if not admin_user:
        return jsonify({"error": "forbidden"}), 403
    unhid = db.unhide_review(review_id)
    db.log_admin_action(admin_user["id"], "unhide_review", target_type="review", target_id=str(review_id))
    return jsonify({"status": "ok", "unhidden": unhid})


@flask_app.route("/api/admin/listings/<int:listing_id>/suspend", methods=["PATCH"])
def api_admin_suspend_listing(listing_id):
    bot_token = bot_module.load_token()
    body = request.get_json(force=True, silent=True) or {}
    admin_user = require_admin(body.get("initData", ""), bot_token)
    if not admin_user:
        return jsonify({"error": "forbidden"}), 403
    suspended = db.suspend_listing(listing_id)
    db.log_admin_action(admin_user["id"], "suspend_listing", target_type="listing", target_id=str(listing_id))
    return jsonify({"status": "ok", "suspended": suspended})


@flask_app.route("/api/admin/listings/<int:listing_id>/unsuspend", methods=["PATCH"])
def api_admin_unsuspend_listing(listing_id):
    bot_token = bot_module.load_token()
    body = request.get_json(force=True, silent=True) or {}
    admin_user = require_admin(body.get("initData", ""), bot_token)
    if not admin_user:
        return jsonify({"error": "forbidden"}), 403
    unsuspended = db.unsuspend_listing(listing_id)
    db.log_admin_action(admin_user["id"], "unsuspend_listing", target_type="listing", target_id=str(listing_id))
    return jsonify({"status": "ok", "unsuspended": unsuspended})


@flask_app.route("/api/admin/audit_log")
def api_admin_audit_log():
    bot_token = bot_module.load_token()
    if not require_admin(request.args.get("initData", ""), bot_token):
        return jsonify({"error": "forbidden"}), 403
    limit = request.args.get("limit", 50, type=int)
    offset = request.args.get("offset", 0, type=int)
    return jsonify(db.get_admin_audit_log(limit=limit, offset=offset))


@flask_app.route("/api/admin/listing/<int:listing_id>")
def api_admin_get_listing(listing_id):
    bot_token = bot_module.load_token()
    if not require_admin(request.args.get("initData", ""), bot_token):
        return jsonify({"error": "forbidden"}), 403
    profile = db.admin_get_listing(listing_id)
    if not profile:
        return jsonify({"error": "not_found"}), 404
    return jsonify(profile)


@flask_app.route("/api/admin/search_listings")
def api_admin_search_listings():
    bot_token = bot_module.load_token()
    if not require_admin(request.args.get("initData", ""), bot_token):
        return jsonify({"error": "forbidden"}), 403
    query = request.args.get("q", "")
    limit = request.args.get("limit", 20, type=int)
    offset = request.args.get("offset", 0, type=int)
    return jsonify(db.admin_search_listings(query, limit=limit, offset=offset))


@flask_app.route("/api/admin/merge_services", methods=["POST"])
def api_admin_merge_services():
    bot_token = bot_module.load_token()
    body = request.get_json(force=True, silent=True) or {}
    admin_user = require_admin(body.get("initData", ""), bot_token)
    if not admin_user:
        return jsonify({"error": "forbidden"}), 403
    source_id = body.get("source_id")
    target_id = body.get("target_id")
    if not isinstance(source_id, int) or not isinstance(target_id, int):
        return jsonify({"error": "invalid_ids"}), 400
    success, msg = db.merge_services(source_id, target_id)
    db.log_admin_action(admin_user["id"], "merge_services", target_type="service", target_id=f"{source_id}->{target_id}", details=msg)
    return jsonify({"status": "ok" if success else "error", "message": msg})


@flask_app.route("/api/admin/categories")
def api_admin_categories():
    bot_token = bot_module.load_token()
    if not require_admin(request.args.get("initData", ""), bot_token):
        return jsonify({"error": "forbidden"}), 403
    return jsonify(db.get_all_categories())


@flask_app.route("/api/admin/categories", methods=["POST"])
def api_admin_add_category():
    bot_token = bot_module.load_token()
    body = request.get_json(force=True, silent=True) or {}
    admin_user = require_admin(body.get("initData", ""), bot_token)
    if not admin_user:
        return jsonify({"error": "forbidden"}), 403
    name = (body.get("name") or "").strip()
    if not name:
        return jsonify({"error": "missing_name"}), 400
    db.add_category(name, icon=body.get("icon", ""), color=body.get("color", ""))
    db.log_admin_action(admin_user["id"], "add_category", target_type="category", target_id=name)
    return jsonify({"status": "ok"})


@flask_app.route("/api/admin/categories/<category>", methods=["DELETE"])
def api_admin_delete_category(category):
    bot_token = bot_module.load_token()
    body = request.get_json(force=True, silent=True) or {}
    admin_user = require_admin(body.get("initData", ""), bot_token)
    if not admin_user:
        return jsonify({"error": "forbidden"}), 403
    success, message = db.delete_category(category)
    db.log_admin_action(admin_user["id"], "delete_category", target_type="category", target_id=category, details=message)
    return jsonify({"status": "ok" if success else "error", "message": message}), (200 if success else 409)


@flask_app.route("/api/admin/feature", methods=["POST"])
def api_admin_feature():
    bot_token = bot_module.load_token()
    body = request.get_json(force=True, silent=True) or {}
    admin_user = require_admin(body.get("initData", ""), bot_token)
    if not admin_user:
        return jsonify({"error": "forbidden"}), 403
    listing_id = body.get("listing_id")
    featured = body.get("featured", True)
    if not isinstance(listing_id, int):
        return jsonify({"error": "invalid_id"}), 400
    db.set_force_featured(listing_id, featured)
    db.log_admin_action(admin_user["id"], "feature_listing" if featured else "unfeature_listing", target_type="listing", target_id=str(listing_id))
    return jsonify({"status": "ok"})


@flask_app.route("/api/admin/analytics/search")
def api_admin_search_analytics():
    bot_token = bot_module.load_token()
    if not require_admin(request.args.get("initData", ""), bot_token):
        return jsonify({"error": "forbidden"}), 403
    days = request.args.get("days", 30, type=int)
    return jsonify(db.get_search_analytics(days=days))


@flask_app.route("/api/admin/analytics/growth")
def api_admin_growth_analytics():
    bot_token = bot_module.load_token()
    if not require_admin(request.args.get("initData", ""), bot_token):
        return jsonify({"error": "forbidden"}), 403
    return jsonify(db.get_growth_analytics())


# ---------- Notifications ----------

@flask_app.route("/api/notifications")
def api_notifications():
    bot_token = bot_module.load_token()
    user = validate_init_data(request.args.get("initData", ""), bot_token)
    if not user:
        return jsonify({"error": "invalid_init_data"}), 401
    return jsonify({
        "notifications": db.get_notifications(user["id"]),
        "unread_count": db.count_unread_notifications(user["id"]),
    })


@flask_app.route("/api/notifications/read", methods=["POST"])
def api_mark_notifications_read():
    bot_token = bot_module.load_token()
    body = request.get_json(force=True, silent=True) or {}
    user = validate_init_data(body.get("initData", ""), bot_token)
    if not user:
        return jsonify({"error": "invalid_init_data"}), 401
    db.mark_notifications_read(user["id"])
    return jsonify({"status": "ok"})


# ---------- Entrepreneur Analytics ----------

@flask_app.route("/api/my-analytics")
def api_my_analytics():
    bot_token = bot_module.load_token()
    user = validate_init_data(request.args.get("initData", ""), bot_token)
    if not user:
        return jsonify({"error": "invalid_init_data"}), 401
    analytics = db.get_entrepreneur_analytics(user["id"])
    if not analytics:
        return jsonify({"error": "not_registered"}), 404
    return jsonify(analytics)


# ---------- Running the bot alongside Flask ----------

def run_bot():
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
    logger.info(f"Flask server starting on port {port}")
    flask_app.run(host="0.0.0.0", port=port)
