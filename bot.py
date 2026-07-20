"""
bot.py
------
This is the "waiter" of our restaurant: it listens to messages coming from
Telegram, figures out what the user wants, asks database.py (the pantry)
to fetch/change data, and replies.

COMMANDS:
  /start           -> welcome message
  /register        -> starts a guided conversation to register as an entrepreneur
  /find <service>  -> lists entrepreneurs offering that service
  /rate <name> <score>  -> rate an entrepreneur from 1-5
  /myprofile       -> see your own registered info
  /cancel          -> cancel whatever conversation you're in

SETUP:
  1. pip install -r requirements.txt
  2. Message @BotFather on Telegram, run /newbot, copy the token it gives you
  3. Put that token in a file called .env (see .env.example) OR paste it
     directly below where BOT_TOKEN is loaded.
  4. Run: python bot.py
"""

import os
import asyncio
import logging
from functools import wraps

from telegram import Update, InlineKeyboardButton, InlineKeyboardMarkup, WebAppInfo
from telegram.ext import (
    Application,
    CommandHandler,
    MessageHandler,
    ConversationHandler,
    ContextTypes,
    CallbackQueryHandler,
    filters,
)

import database as db

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s")
logger = logging.getLogger(__name__)

# ---- Load bot token ----
# Simplest option for learning: put your token directly in a file named
# token.txt (one line, nothing else). We read it here so you never have
# to paste your real token into code you might accidentally share.
def load_token():
    token = os.environ.get("BOT_TOKEN")
    if token:
        return token
    if os.path.exists("token.txt"):
        with open("token.txt") as f:
            return f.read().strip()
    raise RuntimeError(
        "No bot token found. Create a file named token.txt with your token "
        "inside, or set the BOT_TOKEN environment variable."
    )


# ---- Load admin Telegram IDs ----
# Admins are identified by their personal Telegram user ID (a number),
# NOT their username. To find your own ID, message @userinfobot on Telegram.
# Set as an environment variable ADMIN_IDS="123456789,987654321"
# or a file admins.txt with one ID per line (or comma-separated).
def load_admin_ids():
    ids_str = os.environ.get("ADMIN_IDS", "")
    if not ids_str and os.path.exists("admins.txt"):
        with open("admins.txt") as f:
            ids_str = f.read()

    admin_ids = set()
    for part in ids_str.replace("\n", ",").split(","):
        part = part.strip()
        if part.isdigit():
            admin_ids.add(int(part))
    return admin_ids


# The Mini App URL (your Render URL). Set this as an environment variable
# once you know your deployed URL, e.g. https://your-app.onrender.com
WEBAPP_URL = os.environ.get("WEBAPP_URL", "")


def admin_only(handler_func):
    """
    A decorator that wraps a command handler so it only runs for admins.
    Put @admin_only directly above any command function you want to restrict.
    Non-admins get a polite refusal instead of the command running.
    """
    @wraps(handler_func)
    async def wrapper(update: Update, context: ContextTypes.DEFAULT_TYPE):
        if update.effective_user.id not in load_admin_ids():
            await update.message.reply_text("🔒 This command is for bot admins only.")
            return
        return await handler_func(update, context)
    return wrapper


# Conversation states for /register (like steps in a form)
NAME, SERVICES, SOCIALS, PHONE, EMAIL, PICTURE, BUSINESS_ADDRESS, WEBSITE, HOME_ADDRESS = range(9)


# ---------- Basic commands ----------

async def start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    await update.message.reply_text(
        "👋 Welcome! I connect people with local entrepreneurs & freelancers.\n\n"
        "Send /help to see everything I can do."
    )


async def help_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    text = (
        "🧭 *Here's everything I can do:*\n\n"
        "*Finding someone*\n"
        "/find <service> — e.g. /find plumber\n"
        "/services — browse all available services as a tappable menu\n\n"
        "*Managing your own listing*\n"
        "/register — list yourself as an entrepreneur\n"
        "/addservice <service> — add more services later\n"
        "/removeservice <service> — remove a service you no longer offer\n"
        "/myprofile — view your own listing\n"
        "/unregister — remove yourself from the list\n\n"
        "*Ratings*\n"
        "/rate <name> <score 1-5> — rate someone you've worked with\n\n"
        "*Other*\n"
        "/cancel — cancel whatever you're in the middle of"
    )
    if WEBAPP_URL:
        text += "\n/app — open the app version with a browsable menu"
    if update.effective_user.id in load_admin_ids():
        text += "\n\n*You're an admin.* Send /adminhelp to see admin-only commands."

    await update.message.reply_text(text, parse_mode="Markdown")


async def cancel(update: Update, context: ContextTypes.DEFAULT_TYPE):
    context.user_data.clear()
    await update.message.reply_text("Cancelled. No changes were made.")
    return ConversationHandler.END


# ---------- /register conversation ----------
# Compulsory: name, service, phone, email, picture, home address
# Optional (type "skip" to move on): socials, business address, website

async def register_start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    context.user_data.clear()
    await update.message.reply_text(
        "Let's get you registered! (1/8)\n\n"
        "What's your full name (or business name)?"
    )
    return NAME


async def register_name(update: Update, context: ContextTypes.DEFAULT_TYPE):
    context.user_data["name"] = update.message.text.strip()
    await update.message.reply_text(
        "(2/8) List the service(s) you offer, separated by commas.\n"
        "Example: plumbing, pipe installation, leak repair"
    )
    return SERVICES


async def register_services(update: Update, context: ContextTypes.DEFAULT_TYPE):
    context.user_data["services"] = update.message.text.split(",")
    await update.message.reply_text(
        "(3/8) Share your social media handle(s), if you have any.\n"
        "Example: IG @janedoe_plumbing\n\n"
        "Or type 'skip' to move on."
    )
    return SOCIALS


async def register_socials(update: Update, context: ContextTypes.DEFAULT_TYPE):
    text = update.message.text.strip()
    context.user_data["socials"] = "" if text.lower() == "skip" else text
    await update.message.reply_text("(4/8) What's your phone number? (required)")
    return PHONE


async def register_phone(update: Update, context: ContextTypes.DEFAULT_TYPE):
    phone = update.message.text.strip()
    if not phone or len(phone) < 6:
        await update.message.reply_text("That doesn't look like a valid phone number. Please try again.")
        return PHONE
    context.user_data["phone"] = phone
    await update.message.reply_text("(5/8) What's your email address? (required)")
    return EMAIL


async def register_email(update: Update, context: ContextTypes.DEFAULT_TYPE):
    email = update.message.text.strip()
    if "@" not in email or "." not in email.split("@")[-1]:
        await update.message.reply_text("That doesn't look like a valid email. Please try again.")
        return EMAIL
    context.user_data["email"] = email
    await update.message.reply_text(
        "(6/8) Now send a photo of yourself or your business (required) — "
        "just attach/send it as a photo, not a file."
    )
    return PICTURE


async def register_picture(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not update.message.photo:
        await update.message.reply_text("Please send an actual photo (tap the 📎 attach icon → Photo).")
        return PICTURE
    # Telegram stores multiple resolutions of the same photo; the last one is the largest.
    context.user_data["photo_file_id"] = update.message.photo[-1].file_id
    await update.message.reply_text(
        "(7/8) What's your business address? This is shown publicly so clients can find you.\n"
        "Type 'skip' if you don't have a public business location."
    )
    return BUSINESS_ADDRESS


async def register_business_address(update: Update, context: ContextTypes.DEFAULT_TYPE):
    text = update.message.text.strip()
    context.user_data["business_address"] = "" if text.lower() == "skip" else text
    await update.message.reply_text(
        "(7.5/8) Do you have a website? Type it below, or type 'skip'."
    )
    return WEBSITE


async def register_website(update: Update, context: ContextTypes.DEFAULT_TYPE):
    text = update.message.text.strip()
    context.user_data["website"] = "" if text.lower() == "skip" else text
    await update.message.reply_text(
        "(8/8) Last one — your home address (required for our internal verification only).\n\n"
        "🔒 This is kept private. It is never shown in search results or on your public "
        "profile — only you can see it via /myprofile."
    )
    return HOME_ADDRESS


async def register_home_address(update: Update, context: ContextTypes.DEFAULT_TYPE):
    home_address = update.message.text.strip()
    if not home_address:
        await update.message.reply_text("This field is required. Please share your home address.")
        return HOME_ADDRESS

    telegram_id = update.effective_user.id
    fields = {
        "name": context.user_data["name"],
        "socials": context.user_data.get("socials", ""),
        "phone": context.user_data["phone"],
        "email": context.user_data["email"],
        "photo_file_id": context.user_data["photo_file_id"],
        "business_address": context.user_data.get("business_address", ""),
        "website": context.user_data.get("website", ""),
        "home_address": home_address,
    }
    db.register_entrepreneur(telegram_id, fields, context.user_data["services"])

    await update.message.reply_text(
        f"✅ You're registered, {fields['name']}!\n"
        f"Services: {', '.join(s.strip() for s in context.user_data['services'])}\n\n"
        "People can now find you with /find <service> or /services.\n"
        "Your home address is private and won't be shown to anyone."
    )
    context.user_data.clear()
    return ConversationHandler.END


# ---------- /services (browsable menu) ----------

async def services_menu(update: Update, context: ContextTypes.DEFAULT_TYPE):
    services = db.get_all_services()
    if not services:
        await update.message.reply_text("No services registered yet. Be the first with /register!")
        return

    # One button per service, one per row — tapping it runs the equivalent of /find <service>
    keyboard = [
        [InlineKeyboardButton(f"{s['name']} ({s['entrepreneur_count']})", callback_data=f"svc_{s['name']}")]
        for s in services
    ]
    await update.message.reply_text(
        "📋 Tap a service to see who offers it:",
        reply_markup=InlineKeyboardMarkup(keyboard),
    )


async def services_callback(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer()
    service_name = query.data.removeprefix("svc_")
    results = db.find_by_service(service_name)

    if not results:
        await query.edit_message_text(f'No entrepreneurs found for "{service_name}".', reply_markup=None)
        return

    lines = [f'🔎 Results for "{service_name}":\n']
    for r in results:
        rating_text = f"{r['avg_rating']}★ ({r['rating_count']} ratings)" if r["avg_rating"] else "No ratings yet"
        contact_parts = [p for p in [r["phone"], r["socials"]] if p]
        contact_text = " | ".join(contact_parts) if contact_parts else "—"
        lines.append(
            f"👤 {r['name']} — {r['service']}\n"
            f"   Rating: {rating_text}\n"
            f"   Contact: {contact_text}\n"
            + (f"   Location: {r['business_address']}\n" if r["business_address"] else "")
        )
    await query.edit_message_text("\n".join(lines), reply_markup=None)


# ---------- /find ----------

async def find(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not context.args:
        await update.message.reply_text("Usage: /find <service>\nExample: /find plumber")
        return

    service_query = " ".join(context.args)
    results = db.find_by_service(service_query)

    if not results:
        await update.message.reply_text(
            f'No entrepreneurs found for "{service_query}" yet. Be the first with /register!'
        )
        return

    lines = [f'🔎 Results for "{service_query}":\n']
    for r in results:
        rating_text = f"{r['avg_rating']}★ ({r['rating_count']} ratings)" if r["avg_rating"] else "No ratings yet"
        contact_parts = [p for p in [r["phone"], r["socials"]] if p]
        contact_text = " | ".join(contact_parts) if contact_parts else "—"
        lines.append(
            f"👤 {r['name']} — {r['service']}\n"
            f"   Rating: {rating_text}\n"
            f"   Contact: {contact_text}\n"
            + (f"   Location: {r['business_address']}\n" if r["business_address"] else "")
        )
    await update.message.reply_text("\n".join(lines))


# ---------- /rate ----------

async def rate(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if len(context.args) < 2:
        await update.message.reply_text("Usage: /rate <name> <score 1-5>\nExample: /rate Jane Doe 5")
        return

    *name_parts, score_str = context.args
    name = " ".join(name_parts)

    try:
        score = int(score_str)
        if not (1 <= score <= 5):
            raise ValueError
    except ValueError:
        await update.message.reply_text("Score must be a whole number from 1 to 5.")
        return

    success, message = db.rate_entrepreneur(name, update.effective_user.id, score)
    await update.message.reply_text(("✅ " if success else "⚠️ ") + message)


# ---------- /unregister ----------

async def unregister_start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    profile = db.get_entrepreneur_profile(update.effective_user.id)
    if not profile:
        await update.message.reply_text("You're not currently registered, so there's nothing to remove.")
        return

    keyboard = InlineKeyboardMarkup([
        [
            InlineKeyboardButton("✅ Yes, remove me", callback_data="unregister_confirm"),
            InlineKeyboardButton("❌ Cancel", callback_data="unregister_cancel"),
        ]
    ])
    await update.message.reply_text(
        f"Are you sure you want to remove your listing for \"{profile['name']}\"?\n"
        "This deletes your profile, services, and all ratings you've received. "
        "This can't be undone — you'd need to /register again from scratch.",
        reply_markup=keyboard,
    )


async def unregister_callback(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer()  # tells Telegram the button press was received

    if query.data == "unregister_confirm":
        removed = db.delete_entrepreneur(update.effective_user.id)
        text = "🗑️ You've been removed from the list. You can /register again anytime." if removed \
            else "You weren't registered, so nothing changed."
        await query.edit_message_text(text, reply_markup=None)
    else:
        await query.edit_message_text("Cancelled. Your listing is untouched.", reply_markup=None)


# ---------- /addservice ----------

async def add_service(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not context.args:
        await update.message.reply_text(
            "Usage: /addservice <service1, service2, ...>\n"
            "Example: /addservice graphic design, logo design"
        )
        return

    service_text = " ".join(context.args)
    service_names = service_text.split(",")

    added = db.add_services(update.effective_user.id, service_names)
    if not added:
        await update.message.reply_text("You're not registered yet. Use /register first.")
        return

    profile = db.get_entrepreneur_profile(update.effective_user.id)
    await update.message.reply_text(
        f"✅ Updated! Your full service list is now:\n" + ", ".join(profile["services"])
    )


# ---------- /removeservice ----------

async def remove_service(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not context.args:
        await update.message.reply_text(
            "Usage: /removeservice <service1, service2, ...>\n"
            "Example: /removeservice tutoring"
        )
        return

    service_text = " ".join(context.args)
    service_names = service_text.split(",")

    updated = db.remove_services(update.effective_user.id, service_names)
    if not updated:
        await update.message.reply_text("You're not registered yet. Use /register first.")
        return

    profile = db.get_entrepreneur_profile(update.effective_user.id)
    remaining = ", ".join(profile["services"]) if profile["services"] else "(none left — consider /addservice or /unregister)"
    await update.message.reply_text(f"✅ Updated! Your remaining services:\n{remaining}")


# ---------- Admin-only commands ----------

@admin_only
async def admin_help(update: Update, context: ContextTypes.DEFAULT_TYPE):
    await update.message.reply_text(
        "🔧 *Admin commands*\n\n"
        "/stats — see totals (entrepreneurs, services, ratings)\n"
        "/broadcast <message> — message every registered entrepreneur\n"
        "/forceremove <name> — remove any entrepreneur's listing by name",
        parse_mode="Markdown",
    )


@admin_only
async def stats(update: Update, context: ContextTypes.DEFAULT_TYPE):
    s = db.get_stats()
    await update.message.reply_text(
        f"📊 *Bot stats*\n"
        f"Entrepreneurs: {s['entrepreneurs']}\n"
        f"Unique services: {s['services']}\n"
        f"Ratings given: {s['ratings']}",
        parse_mode="Markdown",
    )


@admin_only
async def broadcast(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not context.args:
        await update.message.reply_text("Usage: /broadcast <message>")
        return

    message = " ".join(context.args)
    telegram_ids = db.get_all_telegram_ids()

    sent, failed = 0, 0
    for telegram_id in telegram_ids:
        try:
            await context.bot.send_message(chat_id=telegram_id, text=f"📢 Announcement:\n\n{message}")
            sent += 1
        except Exception as e:
            # Common reasons: the user blocked the bot, or never started a chat with it.
            logger.warning(f"Broadcast failed for {telegram_id}: {e}")
            failed += 1

    await update.message.reply_text(f"Broadcast complete. Sent: {sent}, failed: {failed}.")


@admin_only
async def force_remove(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not context.args:
        await update.message.reply_text("Usage: /forceremove <name>\nExample: /forceremove Jane Doe")
        return

    name = " ".join(context.args)
    success, telegram_id = db.force_delete_by_name(name)
    if success:
        await update.message.reply_text(f'✅ Removed the listing matching "{name}" (user ID {telegram_id}).')
    else:
        await update.message.reply_text(f'No entrepreneur found matching "{name}".')


# ---------- /app (opens the Mini App) ----------

async def open_app(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not WEBAPP_URL:
        await update.message.reply_text(
            "The app isn't set up yet — the bot owner needs to set the WEBAPP_URL environment variable."
        )
        return

    keyboard = InlineKeyboardMarkup([
        [InlineKeyboardButton("🚀 Open App", web_app=WebAppInfo(url=WEBAPP_URL))]
    ])
    await update.message.reply_text(
        "Browse entrepreneurs or manage your listing in the app:",
        reply_markup=keyboard,
    )


# ---------- /myprofile ----------

async def myprofile(update: Update, context: ContextTypes.DEFAULT_TYPE):
    profile = db.get_entrepreneur_profile(update.effective_user.id)
    if not profile:
        await update.message.reply_text("You haven't registered yet. Use /register to get listed.")
        return

    lines = [
        f"👤 {profile['name']}",
        f"Services: {', '.join(profile['services']) if profile['services'] else '(none yet)'}",
        f"Phone: {profile['phone'] or '—'}",
        f"Email: {profile['email'] or '—'}",
        f"Socials: {profile['socials'] or '—'}",
        f"Business address: {profile['business_address'] or '—'}",
        f"Website: {profile['website'] or '—'}",
        f"Photo: {'✅ on file' if profile['photo_file_id'] or profile['photo_base64'] else '—'}",
        f"Registered: {profile['created_at']}",
        "",
        "🔒 Home address (private, never shown to others):",
        profile["home_address"] or "—",
    ]
    await update.message.reply_text("\n".join(lines))


def build_application():
    """
    Builds and configures the bot's Application object (registers every
    command handler) WITHOUT starting it. Kept separate from main() so
    server.py can reuse this exact setup when running the bot alongside
    the Mini App's web server.
    """
    db.init_db()
    token = load_token()

    app = (
        Application.builder()
        .token(token)
        .connect_timeout(30)
        .read_timeout(30)
        .get_updates_read_timeout(30)
        .build()
    )

    register_conv = ConversationHandler(
        entry_points=[CommandHandler("register", register_start)],
        states={
            NAME: [MessageHandler(filters.TEXT & ~filters.COMMAND, register_name)],
            SERVICES: [MessageHandler(filters.TEXT & ~filters.COMMAND, register_services)],
            SOCIALS: [MessageHandler(filters.TEXT & ~filters.COMMAND, register_socials)],
            PHONE: [MessageHandler(filters.TEXT & ~filters.COMMAND, register_phone)],
            EMAIL: [MessageHandler(filters.TEXT & ~filters.COMMAND, register_email)],
            PICTURE: [MessageHandler(filters.PHOTO, register_picture)],
            BUSINESS_ADDRESS: [MessageHandler(filters.TEXT & ~filters.COMMAND, register_business_address)],
            WEBSITE: [MessageHandler(filters.TEXT & ~filters.COMMAND, register_website)],
            HOME_ADDRESS: [MessageHandler(filters.TEXT & ~filters.COMMAND, register_home_address)],
        },
        fallbacks=[CommandHandler("cancel", cancel)],
    )

    app.add_handler(CommandHandler("start", start))
    app.add_handler(CommandHandler("help", help_command))
    app.add_handler(register_conv)
    app.add_handler(CommandHandler("find", find))
    app.add_handler(CommandHandler("services", services_menu))
    app.add_handler(CallbackQueryHandler(services_callback, pattern="^svc_"))
    app.add_handler(CommandHandler("rate", rate))
    app.add_handler(CommandHandler("myprofile", myprofile))
    app.add_handler(CommandHandler("addservice", add_service))
    app.add_handler(CommandHandler("removeservice", remove_service))
    app.add_handler(CommandHandler("unregister", unregister_start))
    app.add_handler(CallbackQueryHandler(unregister_callback, pattern="^unregister_"))
    app.add_handler(CommandHandler("app", open_app))

    # Admin-only
    app.add_handler(CommandHandler("adminhelp", admin_help))
    app.add_handler(CommandHandler("stats", stats))
    app.add_handler(CommandHandler("broadcast", broadcast))
    app.add_handler(CommandHandler("forceremove", force_remove))

    return app


def main():
    # --- Python 3.14 compatibility fix ---
    # Python 3.14 stopped auto-creating an event loop in the main thread.
    # python-telegram-bot's run_polling() still expects one to exist,
    # so we create it ourselves here before anything else runs.
    try:
        asyncio.get_event_loop()
    except RuntimeError:
        asyncio.set_event_loop(asyncio.new_event_loop())

    app = build_application()
    logger.info("Bot starting... press Ctrl+C to stop.")
    app.run_polling()


if __name__ == "__main__":
    main()
