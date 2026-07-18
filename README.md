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
| `/start` | Welcome message + command list |
| `/register` | Guided flow: asks your name → services → socials |
| `/find <service>` | Lists matching entrepreneurs, sorted by rating |
| `/rate <name> <score 1-5>` | Adds a rating for someone |
| `/myprofile` | Shows your own registered info |
| `/unregister` | Removes you (and your services/ratings) from the list, with a confirm step |
| `/cancel` | Exits the registration flow without saving |

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
