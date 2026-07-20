"""
bot.py
------
This is intentionally a thin "front door" now that the Mini App handles
almost everything (registering, browsing, editing your listing, admin
tools). The bot's only real jobs are:
  - Greet people and hand them a button into the Mini App
  - Give admins a few text-command fallbacks that don't require opening
    the app (handy for a quick /stats or /broadcast from your phone)

Everything else — /register, /find, /services, /rate, /myprofile, etc. —
now lives in the Mini App (server.py + webapp/), which has a much better
interface for all of it than a chat conversation ever could.

COMMANDS:
  /start   -> welcome message + button to open the Mini App
  /app     -> opens the Mini App directly
  /help    -> what this bot does, and where the real features live

SETUP:
  1. pip install -r requirements.txt
  2. Message @BotFather on Telegram, run /newbot, copy the token it gives you
  3. Put that token in a file called token.txt (or set BOT_TOKEN env var)
  4. Run: python bot.py   (or python server.py to run the Mini App too)
"""

import os
import asyncio
import logging
from functools import wraps

from telegram import Update, InlineKeyboardButton, InlineKeyboardMarkup, WebAppInfo
from telegram.ext import Application, CommandHandler, ContextTypes

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


def app_button_keyboard():
    """The 'Open App' button used on /start and /app."""
    return InlineKeyboardMarkup([
        [InlineKeyboardButton("🚀 Open App", web_app=WebAppInfo(url=WEBAPP_URL))]
    ])


# ---------- Basic commands ----------

async def start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if WEBAPP_URL:
        await update.message.reply_text(
            "👋 Welcome to VentureVault!\n\n"
            "Find trusted entrepreneurs and freelancers for any job, or list "
            "your own services and get discovered.\n\n"
            "Tap below to get started:",
            reply_markup=app_button_keyboard(),
        )
    else:
        await update.message.reply_text(
            "👋 Welcome! The app isn't set up yet — ask the bot owner to set the WEBAPP_URL environment variable."
        )


async def open_app(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not WEBAPP_URL:
        await update.message.reply_text(
            "The app isn't set up yet — the bot owner needs to set the WEBAPP_URL environment variable."
        )
        return
    await update.message.reply_text("Tap below to open the app:", reply_markup=app_button_keyboard())


async def help_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    text = (
        "🧭 Almost everything lives in the app now — registering, browsing "
        "entrepreneurs, editing your listing, and ratings.\n\n"
        "/app — open it\n"
        "/start — welcome message"
    )
    if update.effective_user.id in load_admin_ids():
        text += "\n\nYou're an admin. Send /adminhelp to see admin-only commands (also available in the app's Admin tab)."

    await update.message.reply_text(text)


# ---------- Admin-only commands ----------
# Kept as a text fallback even though the Mini App's Admin tab covers the
# same ground — sometimes it's faster to fire off a quick /stats than to
# open the app.

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

    app.add_handler(CommandHandler("start", start))
    app.add_handler(CommandHandler("help", help_command))
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