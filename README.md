# Entrepreneur Finder Bot

A Telegram bot where entrepreneurs/freelancers register their service,
and users can search for them by service, see their rating, and get
their socials.

## How it fits together (the restaurant analogy)

| Piece | Restaurant equivalent | File |
|---|---|---|
| Telegram | The front door / delivery service | (Telegram's own servers) |
| Bot | The waiter — takes orders, gives replies | `bot.py` |
| Database logic | The pantry — the only thing that touches the food (data) | `database.py` |
| SQLite file | The actual shelves of ingredients | `entrepreneurs.db` (auto-created) |

## Setup (step by step)

### 1. Install Python dependencies
```bash
pip install -r requirements.txt
```

### 2. Create your bot & get a token
1. Open Telegram, search for **@BotFather**
2. Send `/newbot`, follow the prompts (choose a name and a username ending in "bot")
3. BotFather will give you a token that looks like `123456789:ABCdefGhIJKlmNoPQRsTuVwxYZ`

### 3. Save your token
Create a file called `token.txt` in this folder, and paste **only** the
token inside it (no quotes, no extra text). This file is already excluded
so you don't accidentally share it.

Alternatively, set it as an environment variable:
```bash
export BOT_TOKEN="your-token-here"   # Mac/Linux
set BOT_TOKEN=your-token-here        # Windows cmd
```

### 4. Run it
```bash
python bot.py
```
You should see `Bot starting...` in your terminal. Now open Telegram,
find your bot by its username, and send `/start`.

## Commands

| Command | What it does |
|---|---|
| `/start` | Welcome message |
| `/help` | Full command list (shows admin commands too, if you're an admin) |
| `/register` | Guided flow: asks your name → services → socials |
| `/find <service>` | Lists matching entrepreneurs, sorted by rating |
| `/services` | Tappable menu of every available service |
| `/addservice <service>` | Add more services without losing existing ones |
| `/removeservice <service>` | Remove a service you no longer offer |
| `/rate <name> <score 1-5>` | Adds a rating for someone |
| `/myprofile` | Shows your own registered info |
| `/unregister` | Removes you (and your services/ratings) from the list, with a confirm step |
| `/app` | Opens the Mini App (browsable UI) — only works once WEBAPP_URL is set |
| `/cancel` | Exits the registration flow without saving |

### Admin-only commands
Restricted to Telegram user IDs listed in `ADMIN_IDS` (see setup below).

| Command | What it does |
|---|---|
| `/adminhelp` | Lists admin commands |
| `/stats` | Totals: entrepreneurs, services, ratings |
| `/broadcast <message>` | Sends a message to every registered entrepreneur |
| `/forceremove <name>` | Removes any entrepreneur's listing by name |

**To find your own Telegram user ID:** message **@userinfobot** on Telegram — it replies with your numeric ID.

## The Mini App (browsable web UI inside Telegram)

Beyond typing commands, there's now a proper mini web app that opens
inside Telegram — browse services as tappable chips, search live, and
manage your own listing (register/edit/unregister) through a form
instead of a chat conversation.

**How it works under the hood:**
- `webapp/` — the actual app: `index.html`, `style.css`, `app.js`
- `server.py` — a small Flask server that serves those files AND a
  JSON API (`/api/services`, `/api/find`, `/api/register`, etc.)
  that the app calls
- Every request that touches personal data is verified using Telegram's
  signed `initData` — this cryptographically proves the request really
  came from that Telegram user, so nobody can fake being someone else
- The app automatically matches each visitor's own Telegram theme
  (dark/light, accent color) — this is what "personalized" means here

### Running the Mini App locally
```bash
python server.py
```
This starts the bot AND the web server together on port 5000 (or
whatever `PORT` is set to). Telegram Mini Apps require an **HTTPS**
URL though, so to actually test the app screen (not just the API),
you'll want it deployed — see below.

### Deploying (Render)
1. Deploy this whole folder to Render as a **Web Service**
   (not "Background Worker" — the Mini App needs an open port, which
   `server.py` provides)
2. **Start Command:** `python server.py`
3. **Environment variables** to set on Render:
   - `BOT_TOKEN` — your bot's token
   - `ADMIN_IDS` — your Telegram user ID (comma-separated if more than one admin)
   - `WEBAPP_URL` — set this AFTER your first deploy, once you know your
     Render URL (e.g. `https://your-app.onrender.com`) — then redeploy
4. In **@BotFather**: `/mybots` → your bot → **Bot Settings** → **Menu Button**
   → set it to your `WEBAPP_URL`. This adds a persistent "Open" button
   next to the message box in Telegram, in addition to the `/app` command.

## Example session
```
You: /register
Bot: What's your full name (or business name)?
You: Jane Doe
Bot: List the service(s) you offer, separated by commas.
You: plumbing, leak repair
Bot: Share your social links or contact info.
You: IG @janedoe_plumbing
Bot: ✅ You're registered, Jane Doe!

--- later, another user ---
You: /find plumb
Bot: 🔎 Results for "plumb":
     👤 Jane Doe — plumbing
        Rating: No ratings yet
        Contact: IG @janedoe_plumbing

You: /rate Jane Doe 5
Bot: ✅ Rated Jane Doe 5/5.
```

## How the data is structured (SQL tables)

```
entrepreneurs            services            entrepreneur_services      ratings
-------------            --------            --------------------      -------
id                       id                  entrepreneur_id            id
telegram_id              name                service_id                entrepreneur_id
name                                                                    rater_telegram_id
socials                                                                 score
created_at                                                              created_at
```

`entrepreneur_services` is what's called a **join table** — it's how SQL
represents "many-to-many" relationships (one person, many services; one
service, many people) using two simple columns instead of duplicating data.

## Ideas to extend this (good next practice exercises)

1. **Location filtering** — add a `location` column, search `/find plumber lagos`
2. **Pagination** — if `/find` returns 50 results, only show 5 at a time with a "next" button (`InlineKeyboardMarkup`)
3. **Prevent duplicate ratings** — one rating per rater per entrepreneur (add a UNIQUE constraint)
4. **Migrate to MongoDB** — since you want to practice it too: instead of tables, each entrepreneur becomes one JSON-like document with an embedded `services` array and `ratings` array. Great comparison exercise once this version works.
5. **Deploy it** — Railway.app or Render.com both offer free tiers that can keep a Python bot running 24/7. When you're ready for this, let me know — it's a very different (but short) checklist.

## Notes
- The database file `entrepreneurs.db` is created automatically the first
  time you run the bot — you don't need to set anything up manually.
- `token.txt` should never be committed to GitHub or shared — treat it
  like a password.
