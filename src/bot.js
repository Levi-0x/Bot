/**
 * bot.js
 * ------
 * Direct port of bot.py. Same philosophy as the original: a thin front
 * door that greets people into the Mini App, plus a handful of admin
 * text-command fallbacks. Everything else lives in the Mini App
 * (server.js + webapp/), same as before.
 *
 * One library difference worth knowing up front: python-telegram-bot
 * passes a `context` object into every handler that carries the bot
 * instance, command arguments, etc. bot.js's node-telegram-bot-api is
 * lower-level — a handler only gets `(msg, match)`, where `match` is
 * whatever your regex captured. There's no built-in "context.args"; the
 * regex itself has to capture the argument text, which is why you'll see
 * patterns like /^\/broadcast(?:\s+(.+))?$/ below instead of a plain
 * "/broadcast" command name.
 */

const fs = require("fs");
const TelegramBot = require("node-telegram-bot-api");
const repo = require("./repository");

// ---- Load bot token ----
function loadToken() {
  if (process.env.BOT_TOKEN) return process.env.BOT_TOKEN;
  if (fs.existsSync("token.txt")) return fs.readFileSync("token.txt", "utf8").trim();
  throw new Error(
    "No bot token found. Create a file named token.txt with your token inside, or set the BOT_TOKEN environment variable."
  );
}

// ---- Load admin Telegram IDs ----
function rootAdminIds() {
  const idsStr = process.env.ADMIN_IDS || "";
  return new Set(
    idsStr
      .replace(/\n/g, ",")
      .split(",")
      .map((s) => s.trim())
      .filter((s) => /^\d+$/.test(s))
      .map(Number)
  );
}

// Root admins (env var, fixed at deploy time) UNION admins added on the
// fly via /addadmin (stored in Mongo) — same two-source model as the
// Python version, so any existing admin can promote someone else
// instantly without a redeploy.
async function loadAdminIds() {
  const dbIds = await repo.getAdminIdsFromDb();
  return new Set([...rootAdminIds(), ...dbIds]);
}

function isRootAdmin(telegramId) {
  const idsStr = process.env.ADMIN_IDS || "";
  const rootIdStrings = idsStr.replace(/\n/g, ",").split(",").map((s) => s.trim());
  return rootIdStrings.includes(String(telegramId));
}

const WEBAPP_URL = process.env.WEBAPP_URL || "";

function appButtonKeyboard() {
  // node-telegram-bot-api takes the keyboard as a plain object matching
  // Telegram's own Bot API JSON shape directly — no builder class the
  // way python-telegram-bot's InlineKeyboardMarkup/InlineKeyboardButton
  // wraps it, just the raw structure Telegram's API expects.
  return { reply_markup: { inline_keyboard: [[{ text: "🚀 Open App", web_app: { url: WEBAPP_URL } }]] } };
}

// Mirrors the Python @admin_only decorator, just as a plain wrapper
// function instead of a decorator (JS doesn't have decorators for plain
// functions the way Python does) — it closes over `bot` so it can send
// the "admins only" refusal itself before ever calling the real handler.
function adminOnly(bot, handler) {
  return async (msg, match) => {
    const admins = await loadAdminIds();
    if (!admins.has(msg.from.id)) {
      await bot.sendMessage(msg.chat.id, "🔒 This command is for bot admins only.");
      return;
    }
    return handler(msg, match);
  };
}

function buildBot() {
  const token = loadToken();
  // { polling: true } — this bot checks in with Telegram's servers
  // itself asking "any new messages for me?" on a loop, rather than
  // Telegram pushing to a webhook URL. Simpler to run locally (no public
  // URL needed), which is why it's the same choice the Python version made.
  const bot = new TelegramBot(token, { polling: true });

  // ---------- Basic commands ----------

  bot.onText(/^\/start$/, async (msg) => {
    if (WEBAPP_URL) {
      await bot.sendMessage(
        msg.chat.id,
        "👋 Welcome to GrowthHub!\n\nFind trusted entrepreneurs and freelancers for any job, or list your own services and get discovered.\n\nTap below to get started:",
        appButtonKeyboard()
      );
    } else {
      await bot.sendMessage(msg.chat.id, "👋 Welcome! The app isn't set up yet — ask the bot owner to set the WEBAPP_URL environment variable.");
    }
  });

  bot.onText(/^\/app$/, async (msg) => {
    if (!WEBAPP_URL) {
      await bot.sendMessage(msg.chat.id, "The app isn't set up yet — the bot owner needs to set the WEBAPP_URL environment variable.");
      return;
    }
    await bot.sendMessage(msg.chat.id, "Tap below to open the app:", appButtonKeyboard());
  });

  bot.onText(/^\/help$/, async (msg) => {
    let text = "🧭 Almost everything lives in the app now — registering, browsing entrepreneurs, editing your listing, and ratings.\n\n/app — open it\n/start — welcome message";
    const admins = await loadAdminIds();
    if (admins.has(msg.from.id)) {
      text += "\n\nYou're an admin. Send /adminhelp to see admin-only commands (also available in the app's Admin tab).";
    }
    await bot.sendMessage(msg.chat.id, text);
  });

  // ---------- Admin-only commands ----------

  bot.onText(/^\/adminhelp$/, adminOnly(bot, async (msg) => {
    await bot.sendMessage(
      msg.chat.id,
      "🔧 *Admin commands*\n\n" +
        "/stats — see totals (entrepreneurs, services, ratings)\n" +
        "/broadcast <message> — message every registered entrepreneur\n" +
        "/forceremove <name> — remove any entrepreneur's listing by name\n" +
        "/addadmin <telegram_id> — make someone an admin instantly (no redeploy)\n" +
        "/removeadmin <telegram_id> — remove a bot-added admin\n" +
        "/listadmins — see everyone with admin access",
      { parse_mode: "Markdown" }
    );
  }));

  bot.onText(/^\/stats$/, adminOnly(bot, async (msg) => {
    const s = await repo.getStats();
    await bot.sendMessage(
      msg.chat.id,
      `📊 *Bot stats*\nEntrepreneurs: ${s.entrepreneurs}\nUnique services: ${s.services}\nRatings given: ${s.ratings}`,
      { parse_mode: "Markdown" }
    );
  }));

  // (?:\s+(.+))? — a non-capturing optional group: "/broadcast" alone
  // still matches (so we can show the usage message), but if there IS
  // text after it, match[1] captures everything from there to the end
  // of the message.
  bot.onText(/^\/broadcast(?:\s+([\s\S]+))?$/, adminOnly(bot, async (msg, match) => {
    const message = match[1];
    if (!message) {
      await bot.sendMessage(msg.chat.id, "Usage: /broadcast <message>");
      return;
    }
    const telegramIds = await repo.getAllTelegramIds();
    let sent = 0, failed = 0;
    for (const telegramId of telegramIds) {
      try {
        await bot.sendMessage(telegramId, `📢 Announcement:\n\n${message}`);
        sent++;
      } catch (e) {
        // Same reasons as the Python version's comment: the user blocked
        // the bot, or never actually started a chat with it.
        console.warn(`Broadcast failed for ${telegramId}:`, e.message);
        failed++;
      }
    }
    await bot.sendMessage(msg.chat.id, `Broadcast complete. Sent: ${sent}, failed: ${failed}.`);
  }));

  bot.onText(/^\/forceremove(?:\s+([\s\S]+))?$/, adminOnly(bot, async (msg, match) => {
    const name = match[1];
    if (!name) {
      await bot.sendMessage(msg.chat.id, "Usage: /forceremove <name>\nExample: /forceremove Jane Doe");
      return;
    }
    const { success, telegramId } = await repo.forceDeleteByName(name);
    if (success) {
      await bot.sendMessage(msg.chat.id, `✅ Removed the listing matching "${name}" (user ID ${telegramId}).`);
    } else {
      await bot.sendMessage(msg.chat.id, `No entrepreneur found matching "${name}".`);
    }
  }));

  bot.onText(/^\/addadmin(?:\s+(\d+))?$/, adminOnly(bot, async (msg, match) => {
    if (!match[1]) {
      await bot.sendMessage(msg.chat.id, "Usage: /addadmin <telegram_id>\nThe person you're adding must message @userinfobot to get their numeric ID first.");
      return;
    }
    const newAdminId = Number(match[1]);
    await repo.addAdmin(newAdminId, msg.from.id);
    await bot.sendMessage(msg.chat.id, `✅ ${newAdminId} is now an admin — no redeploy needed.`);
  }));

  bot.onText(/^\/removeadmin(?:\s+(\d+))?$/, adminOnly(bot, async (msg, match) => {
    if (!match[1]) {
      await bot.sendMessage(msg.chat.id, "Usage: /removeadmin <telegram_id>");
      return;
    }
    const targetId = Number(match[1]);
    if (isRootAdmin(targetId)) {
      await bot.sendMessage(msg.chat.id, "That's a root admin (set via Render's ADMIN_IDS) — remove them there instead, not here.");
      return;
    }
    const removed = await repo.removeAdmin(targetId);
    await bot.sendMessage(msg.chat.id, removed ? "✅ Removed." : "That ID wasn't a bot-added admin.");
  }));

  bot.onText(/^\/listadmins$/, adminOnly(bot, async (msg) => {
    const rootIds = [...rootAdminIds()].sort((a, b) => a - b);
    const dbIds = [...(await repo.getAdminIdsFromDb())].sort((a, b) => a - b);
    const lines = ["👑 *Root admins* (Render ADMIN_IDS):"];
    lines.push(...(rootIds.length ? rootIds.map((i) => `• ${i}`) : ["  (none set)"]));
    lines.push("\n🛠 *Added via /addadmin:*");
    lines.push(...(dbIds.length ? dbIds.map((i) => `• ${i}`) : ["  (none)"]));
    await bot.sendMessage(msg.chat.id, lines.join("\n"), { parse_mode: "Markdown" });
  }));

  // ---------- Shared contact (phone verification) ----------
  // Fires when someone taps "Verify with Telegram" in the Mini App, which
  // triggers Telegram's native contact-share prompt. Telegram itself
  // vouches for the number here — that's what makes it trustworthy,
  // versus a number just typed into a form. bot.on("contact", ...) is
  // node-telegram-bot-api's equivalent of python-telegram-bot's
  // MessageHandler(filters.CONTACT, ...).
  bot.on("contact", async (msg) => {
    const contact = msg.contact;
    if (contact.user_id !== msg.from.id) {
      await bot.sendMessage(msg.chat.id, "Please share your own contact, not someone else's.");
      return;
    }
    await repo.setVerifiedPhone(msg.from.id, contact.phone_number);
    await bot.sendMessage(msg.chat.id, "✅ Phone verified! Go back to the app — it should unlock automatically within a few seconds.");
  });

  return bot;
}

module.exports = { buildBot, loadToken, loadAdminIds, rootAdminIds, isRootAdmin, WEBAPP_URL };
