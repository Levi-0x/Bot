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
from telegram.ext import Application, CommandHandler, ContextTypes, MessageHandler, filters

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

    root_admin_ids = set()
    for part in ids_str.replace("\n", ",").split(","):
        part = part.strip()
        if part.isdigit():
            root_admin_ids.add(int(part))

    # Root admins (from Render's ADMIN_IDS) + admins added on the fly via
    # /addadmin, which are stored in the database instead — that's what
    # lets any existing admin add another one instantly, no redeploy needed.
    return root_admin_ids | db.get_admin_ids_from_db()


def is_root_admin(telegram_id: int):
    """Root admins can only be changed via Render's ADMIN_IDS — /removeadmin can't touch them."""
    ids_str = os.environ.get("ADMIN_IDS", "")
    return str(telegram_id) in [p.strip() for p in ids_str.replace("\n", ",").split(",")]


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
        "/forceremove <name> — remove any entrepreneur's listing by name\n"
        "/addadmin <telegram_id> — make someone an admin instantly (no redeploy)\n"
        "/removeadmin <telegram_id> — remove a bot-added admin\n"
        "/listadmins — see everyone with admin access\n"
        "/verify <name> — mark a listing as manually verified (shows a badge)\n"
        "/unverify <name> — remove that badge",
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


@admin_only
async def add_admin_cmd(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not context.args or not context.args[0].isdigit():
        await update.message.reply_text(
            "Usage: /addadmin <telegram_id>\n"
            "The person you're adding must message @userinfobot to get their numeric ID first."
        )
        return

    new_admin_id = int(context.args[0])
    db.add_admin(new_admin_id, added_by=update.effective_user.id)
    await update.message.reply_text(f"✅ {new_admin_id} is now an admin — no redeploy needed.")


@admin_only
async def remove_admin_cmd(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not context.args or not context.args[0].isdigit():
        await update.message.reply_text("Usage: /removeadmin <telegram_id>")
        return

    target_id = int(context.args[0])
    if is_root_admin(target_id):
        await update.message.reply_text(
            "That's a root admin (set via Render's ADMIN_IDS) — remove them there instead, not here."
        )
        return

    removed = db.remove_admin(target_id)
    await update.message.reply_text("✅ Removed." if removed else "That ID wasn't a bot-added admin.")


@admin_only
async def list_admins_cmd(update: Update, context: ContextTypes.DEFAULT_TYPE):
    ids_str = os.environ.get("ADMIN_IDS", "")
    root_ids = {p.strip() for p in ids_str.replace("\n", ",").split(",") if p.strip()}
    db_ids = db.get_admin_ids_from_db()

    lines = ["👑 *Root admins* (Render ADMIN_IDS):"]
    lines += [f"• {i}" for i in root_ids] or ["  (none set)"]
    lines.append("\n🛠 *Added via /addadmin:*")
    lines += [f"• {i}" for i in db_ids] or ["  (none)"]
    await update.message.reply_text("\n".join(lines), parse_mode="Markdown")


async def handle_shared_contact(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """
    Fires when someone taps 'Verify with Telegram' in the Mini App, which
    triggers Telegram's native requestContact() prompt. If they approve,
    Telegram delivers their REAL phone number here as a message — this is
    what makes it trustworthy: Telegram itself vouches for the number,
    not just whatever the person typed into a form.
    """
    contact = update.message.contact
    # Only accept a contact if it's the person's OWN number, not one they
    # forwarded/shared on behalf of someone else in their contacts list.
    if contact.user_id != update.effective_user.id:
        await update.message.reply_text("Please share your own contact, not someone else's.")
        return

    updated = db.set_verified_phone(update.effective_user.id, contact.phone_number)
    if updated:
        await update.message.reply_text(
            "✅ Phone verified! Reopen the app (/app) to see the checkmark on your listing."
        )
    else:
        await update.message.reply_text(
            "You'll need to register first (via the app) before verifying your phone."
        )


@admin_only
async def verify_cmd(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not context.args:
        await update.message.reply_text("Usage: /verify <name>\nExample: /verify Jane Doe")
        return
    name = " ".join(context.args)
    success, telegram_id = db.set_identity_verified_by_name(name, True)
    await update.message.reply_text(
        f'✅ Marked "{name}" as verified.' if success else f'No entrepreneur found matching "{name}".'
    )


@admin_only
async def unverify_cmd(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not context.args:
        await update.message.reply_text("Usage: /unverify <name>")
        return
    name = " ".join(context.args)
    success, telegram_id = db.set_identity_verified_by_name(name, False)
    await update.message.reply_text(
        f'Removed verification from "{name}".' if success else f'No entrepreneur found matching "{name}".'
    )


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
    app.add_handler(CommandHandler("addadmin", add_admin_cmd))
    app.add_handler(CommandHandler("removeadmin", remove_admin_cmd))
    app.add_handler(CommandHandler("listadmins", list_admins_cmd))
    app.add_handler(CommandHandler("verify", verify_cmd))
    app.add_handler(CommandHandler("unverify", unverify_cmd))
    app.add_handler(MessageHandler(filters.CONTACT, handle_shared_contact))

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
