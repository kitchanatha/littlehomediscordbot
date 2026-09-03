# Ragnarok: The New World Guild Bot

Comprehensive Discord bot for guild management using Google Sheets as a database.

## Features

- **Profile Management**: `/register`, `/name_class`, `/profile`, `/history`.
- **Assignment System**: `/assign` Team (A, B, C, or D) and Party (Admin only).
- **Sunday War Roster**: `/war_roster` with automatic updates.
- **Card & Accessory Queues**: `/queue_join`, `/queue_status`, `/queue_list`, etc., with a 3-day cooldown, mirrored to two separate sheets (`คิวการ์ดประดับ` for Card, `คิวประดับ` for Accessory).
- **War Attendance**: joining a configured War voice channel automatically marks a member present (`มา`) on both the attendance sheet and their class tab; `/war_checkin` is a manual fallback and `/war_leave` lets a member self-report an absence (`แจ้งลาแล้ว`).
- **Visual Display Sync**: Automatic class symbols and background colors across all player-facing sheets.
- **Membership Automation**: Automatic status tracking when members leave/rejoin the Discord server.

## Commands

Discord commands call `MemberService`. The service contains business rules and depends only on the `MemberRepository` interface. `GoogleSheetsMemberRepository` is the current storage implementation. A PostgreSQL repository can replace it later without rewriting Discord commands.

Discord User ID is the permanent member identity. Character name is editable and must never be used as the primary identity.

## Google Sheet used

Set `GOOGLE_SHEET_ID` to the ID of your guild's Google Sheet (the long ID in its URL).

The bot uses two kinds of tabs in that sheet:

**Internal (bot-managed, not meant to be hand-edited):**

- `Members`
- `Name_History`
- `Class_History`
- `Team_History`
- `Party_History`
- `Classes`
- `Legacy_Members`
- `Audit_Log`
- `Queue_Entries`
- `Queue_History`

**Player-facing (the guild's original layout, kept exactly as-is — the bot only edits cell text/color/attendance marks in these, never the structure):**

- `รายชื่อตี้วอร์ห้องหลัก` (main war room roster)
- `ตี้วอร์วันอาทิตย์` (weekly Sunday War lineup)
- `รายชื่ออีลิทตีอบอสวันอาทิตย์` (elite boss roster)
- `เช็คขาด-ลา` (attendance)
- `Knight`, `Paladin`, `Hunter`, `Assassin`, `Wizard`, `Priest`, `Monk`, `Blacksmith`, `Gunslinger`, `Druid` (one tab per class, also used for attendance)
- `คิวการ์ดประดับ` (Card queue display)
- `คิวประดับ` (Accessory queue display)

These names must match the tabs that actually exist in the connected Sheet exactly (including spacing/punctuation) — the bot does not create these player-facing tabs itself.

`Legacy_Members` is read during first registration. If the character name matches an old guild member, the bot carries over Class, Team, and Party. The new `Members` row is still keyed by Discord ID.

## 1. Install Node.js

Install Node.js 20 or newer, then verify:

```bash
node --version
npm --version
```

## 2. Install dependencies

```bash
npm install
```

## 3. Create a Discord application and bot

1. Open Discord Developer Portal.
2. Create an application.
3. Open **Bot** and create the bot user.
4. Copy the bot token into `DISCORD_TOKEN`.
5. In **General Information**, copy Application ID into `DISCORD_CLIENT_ID`.
6. Enable the bot for your guild/server and copy the server ID into `DISCORD_GUILD_ID`.
7. Invite the bot with scopes `bot` and `applications.commands`.
8. **Required for `/register_all`**: In the **Bot** tab, scroll down to **Privileged Gateway Intents** and enable **Server Members Intent**. Then set `ENABLE_MEMBERS_INTENT=true` in your `.env`.

Phase 1 only needs the normal Guilds intent, but Phase 2/3 bulk registration and membership automation require the Members intent.

## Guild Membership Automation

The bot automatically handles members leaving or joining the configured Discord server:

- **Guild Leave**: When a registered member leaves the server, their status is set to `Left`, and they are automatically removed from all active queues (Card/Accessory) without a cooldown.
- **Guild Rejoin**: When a member with `Left` status rejoins the server, their status is automatically set back to `Active`, and their Discord username is updated.
- **Reconciliation**: On startup, if `ENABLE_MEMBERS_INTENT` is `true`, the bot compares the current server members with the spreadsheet and marks any missing members as `Left`.

All membership changes are recorded in the `Audit_Log` with the actor `SYSTEM`.

## War Attendance (Check-in / Leave)

Optional — leave `WAR_CHECKIN_VOICE_CHANNEL_IDS` blank to disable entirely.

- Set `WAR_CHECKIN_VOICE_CHANNEL_IDS` to a comma-separated list of the War voice channel IDs (e.g. `1535489015187513354,1535489924231462973`). Enable **Server Members Intent** is not required for this, but the bot does need to actually be in the server; when this variable is set the bot requests the `GuildVoiceStates` intent automatically.
- A member joining any of those voice channels is marked present (`มา`) for today's War, on both the `เช็คขาด-ลา` sheet and their class tab. No command needed.
- `/war_checkin` is a manual fallback for anyone the automatic check-in misses (e.g. already in the channel when the bot restarted).
- `/war_leave` lets a member self-report an absence (`แจ้งลาแล้ว`) ahead of time. Set `WAR_LEAVE_CHANNEL_ID` to restrict it to one text channel (e.g. `1535950902421102622`); leave it blank to allow it anywhere.
- Attendance columns are matched by date, tolerant of the guild's existing inconsistent header formatting (`war 31/7/69`, `War  13/8/69`, ...). New columns the bot creates always use `War D/M/YY` (Buddhist year), added automatically if today's date has no column yet.

## 4. Create Google service account

1. Create/select a Google Cloud project.
2. Enable **Google Sheets API**.
3. Create a Service Account.
4. Create a key for it and copy its email/private key.
5. Share the bot database Google Sheet with the service-account email as **Editor**.
6. Put the email/private key in `.env`.

Do not commit the service-account private key.

## 5. Configure `.env`

Copy:

```bash
cp .env.example .env
```

Then fill in:

```env
DISCORD_TOKEN=...
DISCORD_CLIENT_ID=...
DISCORD_GUILD_ID=...
GOOGLE_SHEET_ID=1DEC5SjzqWXnAD-mySk-MQPIeteS8ETGlNBpG4EM9jW4
GOOGLE_SERVICE_ACCOUNT_EMAIL=...
GOOGLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
ASSIGN_ROLE_IDS=857246001807360060,857258558605361154
```

## 6. Register slash commands

```bash
npm run deploy:commands
```

Guild commands normally appear quickly in the selected Discord server.

## 7. Start the bot

```bash
npm start
```

Expected log:

```text
INFO Bot ready as YourBot#0000
```

## 8. Test Phase 1

### Register an old member

Example:

```text
/register character_name:Piko
```

Expected: Knight + Team A + Party 8 are pulled from `Legacy_Members`, while Discord ID is written into `Members`.

### Profile

```text
/profile
```

Expected: current character, class, team, party and status.

### Change name

```text
/name new_name:PikoX
```

Expected: `Members.CharacterName` changes and one immutable row is added to `Name_History`.

### Change class

```text
/class new_class:Hunter
```

Expected: class is validated from the `Classes` tab, then `Members.Class` changes and a row is added to `Class_History`.

### History

```text
/history
```

Expected: previous name/class/team/party changes are shown without deleting old records.

### War Roster

```text
/war_roster
/war_roster team:A
/war_roster team:C party:4
```

Expected: Show active members grouped by Team and Party.

### Assign (Admin only)

```text
/assign member:@User team:C party:4
```

Expected: member's default guild assignment is updated, history and audit log are recorded.

## Permissions

| Command | Member | Officer | Admin |
|---------|--------|---------|-------|
| `/register` | Yes | Yes | Yes |
| `/profile` | Yes | Yes | Yes |
| `/name` | Yes | Yes | Yes |
| `/class` | Yes | Yes | Yes |
| `/name_class` | Yes | Yes | Yes |
| `/history` | Yes | Yes | Yes |
| `/register_all` | No | No | Yes |
| `/war_roster` | Yes | Yes | Yes |
| `/assign` | No | No | Yes |
| `/queue_join` | Yes | Yes | Yes |
| `/queue_leave` | Yes | Yes | Yes |
| `/queue_status` | Yes | Yes | Yes |
| `/queue_list` | Yes | Yes | Yes |
| `/queue_add` | No | No | Yes |
| `/queue_remove` | No | No | Yes |
| `/war_checkin` | Yes | Yes | Yes |
| `/war_leave` | Yes | Yes | Yes |

Note: `ASSIGN_ROLE_IDS` must be configured in `.env`. Multiple role IDs can be separated by commas.

## Tests

```bash
npm test
```

## Important Phase 1 limitations

- No `/team` or `/party` command yet.
- Legacy matching is intentionally conservative; the bot does not guess uncertain identities.
- Real Discord and Google credentials are required before the bot can run end-to-end.
- Auto check-in only fires on a voice-channel *join*; a member already sitting in the channel when the bot (re)starts needs to run `/war_checkin` manually once.

### Concurrency and ID Generation

For Phase 1, MemberIDs are generated by reading the existing IDs from the sheet and incrementing the highest value. This approach has a known concurrency limitation: if multiple users register at the exact same millisecond, they might be assigned the same MemberID. 

Similarly, legacy record linking is performed in two steps (create member, then link legacy). In extremely rare cases where two users claim the same legacy name simultaneously, Google Sheets' lack of row-level locking might lead to both registrations succeeding before the first link is written back. 

For a guild-scale bot, these are practical trade-offs. Future phases with PostgreSQL will use native database sequences and transactions to eliminate these risks.
