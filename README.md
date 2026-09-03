# Little Home Guild Bot

Discord bot for managing the "Little Home" Ragnarok Online guild, using a Google Sheet as the
database. Built for one specific guild's real, hand-maintained spreadsheet — the bot reads and
writes into the guild's existing tabs rather than owning its own separate data model.

## Features

- **Profile management**: `/register`, `/name`, `/class`, `/name_class`, `/profile`, `/history`.
- **Assignment**: `/assign` a member to a Team (A/B/C/D) and Party (Admin only).
- **War roster**: `/war_roster`, filterable by team/party.
- **War attendance**: joining a configured War voice channel auto-marks a member present (`มา`)
  on the attendance sheet and their class tab. `/war_checkin` is a manual fallback; `/war_leave`
  lets a member self-report an absence (`แจ้งลาแล้ว`) ahead of time.
- **Card & Accessory queues**: `/queue_join`, `/queue_leave`, `/queue_status`, `/queue_list`,
  `/queue_add`, `/queue_remove`, with a 3-day rejoin cooldown, mirrored to `คิวการ์ดประดับ` and
  `คิวประดับ`.
- **Auto-register**: members posting the guild's registration-form template in a configured
  channel are registered automatically, no slash command needed.
- **Auto name/class change**: members posting a name/class change request in a configured
  channel have it applied to their own profile automatically.
- **Membership automation**: a member leaving the Discord server is marked `Left` (and pulled
  from all active queues); rejoining restores them to `Active`. A startup reconciliation pass
  catches anyone who left while the bot was offline.
- **Visual sync**: class symbols/colors kept in sync across every player-facing sheet.

## Architecture

Discord commands call into `*Service` classes (`MemberService`, `QueueService`,
`AttendanceService`, `ClassService`, `WarRosterService`), which depend only on repository
*interfaces* (`MemberRepository`, `QueueRepository`, `AttendanceRepository`). The current
implementation of each is Google-Sheets-backed (`GoogleSheets*Repository`); swapping to a real
database later means writing a new repository implementation, not touching commands or business
logic.

Discord User ID is the permanent member identity. Character name is editable and must never be
used as a key.

## Google Sheet structure

Set `GOOGLE_SHEET_ID` to the ID from your guild's Sheet URL. The bot expects two kinds of tabs:

**Internal (bot-managed — don't hand-edit):**

- `Members`, `Name_History`, `Class_History`, `Team_History`, `Party_History`
- `Classes` — one row per class: `ClassID`, `ClassName`, `Active`, `SortOrder`, `Symbol`,
  `ColorHex`, `Icon` (an `IMAGE()` formula). Edit `ColorHex`/`Icon`/`Symbol` here to change the
  guild-wide look; re-run `npm run apply-class-colors` and `npm run add-class-icons` afterward
  to push changes out to every other tab.
- `Legacy_Members`, `Audit_Log`, `Queue_Entries`, `Queue_History`
- `Game_Roster_CombatPower` — the durable, Discord-independent source of truth for every known
  in-game character's Combat Power and Class (from the guild's own class tabs / war roster),
  linked to a Discord `Members` row only once that person actually registers. See
  `src/scripts/update-combat-power.ts`, `link-war-roster.ts`, `link-class-tabs.ts`.

**Player-facing (the guild's own layout — the bot only ever edits cell text/color/attendance
marks here, never structure):**

- `รายชื่อตี้วอร์ห้องหลัก` (main war room roster grid)
- `เช็คขาด-ลา` (attendance)
- `Knight`, `Paladin`, `Hunter`, `Assassin`, `Wizard`, `Priest`, `Monk`, `Blacksmith`,
  `Gunslinger`, `Druid` (one tab per class; also used for attendance)
- `คิวการ์ดประดับ` / `คิวประดับ` (Card / Accessory queue displays)
- `War Plan (Draft)` — created on demand by `npm run plan-war-teams`; never touches the live
  roster above.

Tab names must match exactly (spacing/punctuation included) — the bot does not create these
player-facing tabs itself. `Legacy_Members` is read at first registration: if the character name
matches an old guild member, Class/Team/Party carry over automatically.

---

## Setup (from scratch)

### 1. Install Node.js

Node.js 20+ required.

```bash
node --version
npm --version
```

### 2. Install dependencies

```bash
npm install
```

### 3. Create the Discord application

1. Go to the [Discord Developer Portal](https://discord.com/developers/applications) → **New
   Application**.
2. Open **Bot** → **Add Bot**. Copy the token → `DISCORD_TOKEN`.
3. Under **General Information**, copy the **Application ID** → `DISCORD_CLIENT_ID`.
4. Under **OAuth2 → URL Generator**, check scopes `bot` and `applications.commands`, then check
   the bot permissions it needs (Send Messages, Manage Roles if using `/assign`, Connect/View
   Channels for voice check-in, etc.). Open the generated URL and invite it to your server.
5. Copy your Discord server (guild) ID → `DISCORD_GUILD_ID` (enable Developer Mode in Discord
   settings, then right-click the server icon → Copy Server ID).
6. **Privileged Gateway Intents** (still in the **Bot** tab): enable **Server Members Intent**
   if you'll use `/register_all` or membership reconciliation, and **Message Content Intent** if
   you'll use the auto-register or auto name/class-change channels. Enable each corresponding
   `.env` flag/channel ID only after turning on its intent here, or the bot will fail to log in.

### 4. Create the Google Cloud project + service account

1. Create or select a project at [Google Cloud Console](https://console.cloud.google.com).
2. **APIs & Services → Library** → enable the **Google Sheets API**.
3. **IAM & Admin → Service Accounts → Create Service Account**. Any name is fine; no project
   roles are required (access is granted via sharing the Sheet directly, not IAM).
4. Open the new service account → **Keys → Add Key → Create new key → JSON**. This downloads a
   JSON file containing `client_email` and `private_key` — these become
   `GOOGLE_SERVICE_ACCOUNT_EMAIL` and `GOOGLE_PRIVATE_KEY`.
5. Open your guild's Google Sheet → **Share** → paste the service account's email → give it
   **Editor** access.
6. (Only needed if you want the real class-icon images from `add-class-icons.ts` to render, not
   just colors/emoji) Also enable the **Google Drive API** in the same project — see the
   "Class icons" note below.

Never commit the JSON key or the private key value anywhere.

### 5. Configure `.env`

```bash
cp .env.example .env
```

| Variable | Required | Notes |
|---|---|---|
| `DISCORD_TOKEN` | Yes | From step 3.2 |
| `DISCORD_CLIENT_ID` | Yes | From step 3.3 |
| `DISCORD_GUILD_ID` | Yes | From step 3.5 |
| `GOOGLE_SHEET_ID` | Yes | The long ID in the Sheet's URL |
| `GOOGLE_SERVICE_ACCOUNT_EMAIL` | Yes | From the downloaded JSON key |
| `GOOGLE_PRIVATE_KEY` | Yes | From the JSON key, keep the `\n` escapes on one line, wrapped in quotes |
| `ASSIGN_ROLE_IDS` | Yes | Comma-separated Discord role IDs allowed to run admin commands |
| `ENABLE_MEMBERS_INTENT` | No | `true` to enable `/register_all` + leave/rejoin reconciliation (needs the Discord-side intent too) |
| `WAR_CHECKIN_VOICE_CHANNEL_IDS` | No | Comma-separated voice channel IDs for auto check-in. Blank disables the feature |
| `WAR_LEAVE_CHANNEL_ID` | No | Restrict `/war_leave` to one channel; blank allows it anywhere |
| `AUTO_REGISTER_CHANNEL_ID` | No | Channel where posted registration forms auto-register the poster. Needs Message Content Intent |
| `NAME_CLASS_CHANGE_CHANNEL_ID` | No | Channel where posted change requests auto-apply. Needs Message Content Intent |
| `MEMBER_UPDATE_CHANNEL_ID` | No | Channel where a member leaving the server is announced |

### 6. Register slash commands

```bash
npm run deploy:commands
```

Guild-scoped commands (registered against `DISCORD_GUILD_ID`) show up within seconds.

### 7. Run the bot

For a quick local run:

```bash
npm start
```

Expect:

```text
INFO Validating Google Sheets database readiness...
✅ Database readiness verified
INFO Bot ready as YourBot#0000
INFO Starting member reconciliation...
✅ Reconciliation finished. Marked 0 members as Left.
```

For a persistent local run that survives crashes (recommended over a bare `npm start` left in a
terminal), use the included pm2 config:

```bash
npm install -g pm2
pm2 start ecosystem.config.cjs
pm2 save
pm2 status
pm2 logs ragnarok-guild-bot
```

**Important**: never run more than one instance against the same bot token at once (e.g. a
leftover `npm start` in one terminal plus a `pm2`-managed one) — both will connect to Discord
simultaneously and every command/event gets handled (and answered) twice.

To run it on a free, always-on cloud VM instead of your own machine, see
[DEPLOYMENT.md](DEPLOYMENT.md) (Oracle Cloud "Always Free" tier walkthrough).

---

## Commands & permissions

| Command | Member | Admin |
|---|---|---|
| `/register` | ✅ | ✅ |
| `/profile` | ✅ | ✅ |
| `/name` | ✅ | ✅ |
| `/class` | ✅ | ✅ |
| `/name_class` | ✅ (self) | ✅ (any member, via `member` option) |
| `/history` | ✅ | ✅ |
| `/war_roster` | ✅ | ✅ |
| `/war_checkin` | ✅ | ✅ |
| `/war_leave` | ✅ | ✅ |
| `/queue_join` / `/queue_leave` / `/queue_status` / `/queue_list` | ✅ | ✅ |
| `/register_all` | ❌ | ✅ |
| `/assign` | ❌ | ✅ |
| `/queue_add` / `/queue_remove` | ❌ | ✅ |

"Admin" = a member holding one of the roles listed in `ASSIGN_ROLE_IDS`.

---

## Maintenance / admin scripts (`npm run <name>`)

These are one-off Node scripts (not part of the live bot process) for bulk data operations on
the connected Sheet. Safe to re-run anytime unless noted:

| Script | What it does |
|---|---|
| `apply-class-colors` | Colors every character-name cell across all class tabs, attendance, war roster, and `Game_Roster_CombatPower` by class (reads `Classes!ColorHex`). Re-run after changing colors. |
| `add-class-icons` | Adds an `IMAGE()`-formula "Icon" column to `Game_Roster_CombatPower`, all class tabs, attendance, and both queue displays. |
| `sort-attendance-by-class` | Regroups `เช็คขาด-ลา` rows into contiguous class blocks, renumbering each block 1..N, recoloring as it goes. |
| `plan-war-teams` | Proposes a balanced Team A/B/C party split (CP + class mix, guaranteed 1 Priest per party) into a new `War Plan (Draft)` tab. Never touches the live roster. |
| `update-combat-power` | Upserts transcribed `{characterName, combatPower}` data into `Game_Roster_CombatPower` and carries CP over to any already-linked `Members` row. |
| `link-war-roster` / `link-class-tabs` | Backfills Team/Party/Class into `Game_Roster_CombatPower` from the war-roster grid / class tabs (the guild's own ground truth), using exact → normalized → fuzzy name matching. |
| `insert-cp-column-after-name` | Inserts a "Combat Power" column right after the name column on every class tab. |
| `backfill:auto-register` / `backfill:name-class-change` | One-time replay of historical messages in the auto-register / name-class-change channels, for messages posted before those features existed. Rate-limited with delays — expect several minutes for a large channel history. |
| `push-combat-power-to-tabs`, `revert-and-combine-class-tabs` | Superseded by `insert-cp-column-after-name`; kept for reference/rollback only. |
| `register-card-queue`, `register-accessory-queue` | **One-off, session-specific**: hardcoded name lists from a particular bulk-import request. Not a reusable template — copy the pattern into a new script rather than editing the name list in these. |

## Class icon images

`Classes!Icon` and every propagated "Icon" column use `=IMAGE(url, 4, 30, 30)` pointing at the
reference game's own CDN. Two things to know:

- Google Sheets sometimes shows `#REF! "Please use a desktop web browser..."` on an
  API-written `IMAGE()` formula until the sheet owner opens the file in an actual browser once —
  this is a real Sheets quirk, not a bug in these scripts.
- Google Drive hosting was tried as a more reliable alternative but hit two dead ends worth
  knowing about if you revisit this: a service account has **no Drive storage quota** on a
  regular personal Google account (`storageQuotaExceeded` — Shared Drives require Google
  Workspace), and the Drive API must be explicitly enabled per Cloud project before any Drive
  call works at all.

## Tests

```bash
npm run typecheck
npm test
```

## Known limitations

- Legacy-member matching (`Legacy_Members`) is intentionally conservative — it never guesses an
  uncertain identity match.
- MemberID/HistoryID generation reads existing IDs and increments the max; two registrations at
  the exact same millisecond could theoretically collide. Acceptable at guild scale; a future
  real-database backend would use native sequences instead.
- Auto war check-in only fires on a voice-channel *join* event — a member already sitting in the
  channel when the bot (re)starts needs one manual `/war_checkin`.
- Roughly 15-25% of names across attendance/queue sheets don't auto-link to
  `Game_Roster_CombatPower` due to spelling variants beyond what exact/fuzzy matching catches
  (nicknames, decorative characters, typos) — these show up as unmatched in each script's
  console output and are resolved ad hoc as they're noticed.
