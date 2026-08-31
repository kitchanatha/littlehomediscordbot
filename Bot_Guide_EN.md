### ADMIN COMMANDS

/assign

Assign a registered member's default guild Team and Party.

Example:

    /assign member:@ATT team:C party:4

Requirements:
- Authorized roles only (must have a role listed in ASSIGN_ROLE_IDS)
- Member must already be registered
- Team must be A, B, or C
- Party must be a positive integer (1 or higher)

/register_all

Register all server members who are not yet in the system with a "Pending" status.

Example:
- `/register_all` (Registers everyone)
- `/register_all role:@NewMember` (Registers only users with the specific role)

Requirements:
- Authorized roles only
- Discord [Guild Members] intent must be enabled in the Developer Portal
- Bots are automatically skipped

After bulk registration, members can use `/name_class` to fill in their character details.

/queue_add

Manually add a member to a queue.

Example:
- `/queue_add member:@User type:Card`

/queue_remove

Manually remove a member from a queue. This triggers a 3-day cooldown for the target member.

Example:
- `/queue_remove member:@User type:Card`

After assignment:
- Members table is updated
- Team/Party history is recorded
- Audit log is recorded
- War roster updates automatically (via Google Sheet formulas)

Members cannot assign themselves.

### MEMBER COMMANDS

/register

Register your character name and class. Both fields are required.

Example:
- `/register name:ATT-03 class:Priest`

/name_class

Update your character name and/or class.

Examples:
- `/name_class name:ATT-03`
- `/name_class class:Priest`
- `/name_class name:ATT-03 class:Priest`

Admin/Guild Leader:
- `/name_class member:@User name:ATT-03 class:Priest`

/war_roster

View the current Sunday War Team/Party roster.

Examples:
- `/war_roster` (Show all teams)
- `/war_roster team:A` (Show Team A only)
- `/war_roster team:C party:4` (Show specific party)

Requirements:
- Member must be registered
- This command is read-only

/queue_join

Join the Card or Accessory queue.
- `/queue_join type:Card`

/queue_leave

Leave a queue. You will incur a 3-day cooldown for that queue type.
- `/queue_leave type:Card`

/queue_status

Check your current positions and cooldowns.
- `/queue_status`

/queue_list

View the current members in a queue.
- `/queue_list type:Card`

### Global Class Symbols & Colors

Player names are automatically formatted across all guild sheets and Discord responses:
- **Format:** `<SYMBOL> <CharacterName>` (e.g., 🛡️ PaladinPlayer)
- **Colors:** The player name cell in Google Sheets receives a background color based on their class.
- **Automatic Sync:** Symbols and colors update immediately whenever a member changes their class or name.

Affected Sheets:
- คิวการ์ด คิวประดับ (Queue Display)
- War_Roster_Template
- Main War Roster
- Elite Boss Roster
- Sunday War Roster
- Attendance Check
- All class-specific tabs

### Visual Queue Display

You can view the active queues in real-time on the Google Sheet tab **"คิวการ์ด คิวประดับ"**:
- **Left Side (Cols A-D):** Card Queue
- **Right Side (Cols F-I):** Accessory Queue

This display updates automatically whenever someone joins/leaves a queue or updates their profile details.

### Guild Membership Automation

The bot automatically manages profiles when people leave or join the server:

- **Leaving the Guild**: If you leave the Discord server, your status is set to `Left`, and you are automatically removed from all queues (Card/Accessory). Leaving the guild does **not** trigger the 3-day cooldown.
- **Returning to the Guild**: If you rejoin the server later, your profile will be reactivated automatically. Your history (Name, Class, Team, Party) will be preserved.
