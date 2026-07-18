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

from telegram import Update, InlineKeyboardButton, InlineKeyboardMarkup
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


# Conversation states for /register (like steps in a form)
NAME, SERVICES, SOCIALS = range(3)


# ---------- Basic commands ----------

async def start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    await update.message.reply_text(
        "👋 Welcome! I connect people with local entrepreneurs & freelancers.\n\n"
        "• /find <service>  — e.g. /find plumber\n"
        "• /services — browse all available services\n"
        "• /register — list yourself as an entrepreneur\n"
        "• /addservice <service> — add more services later\n"
        "• /removeservice <service> — remove a service you no longer offer\n"
        "• /rate <name> <score 1-5> — rate someone\n"
        "• /myprofile — view your own listing\n"
        "• /unregister — remove yourself from the list"
    )


async def cancel(update: Update, context: ContextTypes.DEFAULT_TYPE):
    context.user_data.clear()
    await update.message.reply_text("Cancelled. No changes were made.")
    return ConversationHandler.END


# ---------- /register conversation ----------

async def register_start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    await update.message.reply_text(
        "Let's get you registered! First — what's your full name (or business name)?"
    )
    return NAME


async def register_name(update: Update, context: ContextTypes.DEFAULT_TYPE):
    context.user_data["name"] = update.message.text.strip()
    await update.message.reply_text(
        "Got it. Now list the service(s) you offer, separated by commas.\n"
        "Example: plumbing, pipe installation, leak repair"
    )
    return SERVICES


async def register_services(update: Update, context: ContextTypes.DEFAULT_TYPE):
    context.user_data["services"] = update.message.text.split(",")
    await update.message.reply_text(
        "Last step — share your social links or contact info (any format).\n"
        "Example: IG @janedoe_plumbing | +234...  "
    )
    return SOCIALS


async def register_socials(update: Update, context: ContextTypes.DEFAULT_TYPE):
    socials = update.message.text.strip()
    telegram_id = update.effective_user.id
    name = context.user_data["name"]
    services = context.user_data["services"]

    db.register_entrepreneur(telegram_id, name, socials, services)

    await update.message.reply_text(
        f"✅ You're registered, {name}!\n"
        f"Services: {', '.join(s.strip() for s in services)}\n"
        f"Socials: {socials}\n\n"
        "People can now find you with /find <service>."
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
        await query.edit_message_text(f'No entrepreneurs found for "{service_name}".')
        return

    lines = [f'🔎 Results for "{service_name}":\n']
    for r in results:
        rating_text = f"{r['avg_rating']}★ ({r['rating_count']} ratings)" if r["avg_rating"] else "No ratings yet"
        lines.append(
            f"👤 {r['name']} — {r['service']}\n"
            f"   Rating: {rating_text}\n"
            f"   Contact: {r['socials']}\n"
        )
    await query.edit_message_text("\n".join(lines))


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
        lines.append(
            f"👤 {r['name']} — {r['service']}\n"
            f"   Rating: {rating_text}\n"
            f"   Contact: {r['socials']}\n"
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
        await query.edit_message_text(text)
    else:
        await query.edit_message_text("Cancelled. Your listing is untouched.")


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


# ---------- /myprofile ----------

async def myprofile(update: Update, context: ContextTypes.DEFAULT_TYPE):
    profile = db.get_entrepreneur_profile(update.effective_user.id)
    if not profile:
        await update.message.reply_text("You haven't registered yet. Use /register to get listed.")
        return
    await update.message.reply_text(
        f"👤 {profile['name']}\n"
        f"Services: {', '.join(profile['services']) if profile['services'] else '(none yet)'}\n"
        f"Socials: {profile['socials']}\nRegistered: {profile['created_at']}"
    )


def main():
    # --- Python 3.14 compatibility fix ---
    # Python 3.14 stopped auto-creating an event loop in the main thread.
    # python-telegram-bot's run_polling() still expects one to exist,
    # so we create it ourselves here before anything else runs.
    try:
        asyncio.get_event_loop()
    except RuntimeError:
        asyncio.set_event_loop(asyncio.new_event_loop())

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
        },
        fallbacks=[CommandHandler("cancel", cancel)],
    )

    app.add_handler(CommandHandler("start", start))
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

    logger.info("Bot starting... press Ctrl+C to stop.")
    app.run_polling()


if __name__ == "__main__":
    main()
