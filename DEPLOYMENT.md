# Deploying the bot for free on Oracle Cloud (Always Free tier)

This runs the bot 24/7 on a small VM that's genuinely free forever (no trial period), using
Oracle's "Always Free" resource allowance. The bot only makes outbound connections (Discord
gateway, Google Sheets API) — no inbound ports need to be opened.

## 1. Create an Oracle Cloud account

1. Go to https://signup.oraclecloud.com and sign up. A credit card is required for identity
   verification, but Always Free resources are never charged.
2. Pick a **Home Region** carefully — Always Free resources are tied to this region and can't
   be moved later. Pick one geographically close to you or your Discord server's region.

## 2. Create the VM instance

1. In the Oracle Cloud Console, go to **Compute → Instances → Create Instance**.
2. Name it something like `ragnarok-guild-bot`.
3. Under **Image and shape**, click **Edit**:
   - Image: **Canonical Ubuntu** (22.04 or newer).
   - Shape: click **Change shape**, select **Ampere** (ARM-based), pick `VM.Standard.A1.Flex`.
     Set **1 OCPU / 6 GB memory** (well within the Always Free allowance of 4 OCPU / 24 GB
     total, and plenty for this bot). The AMD `VM.Standard.E2.1.Micro` shape also works if you
     prefer x86, but has less RAM (1 GB).
4. Under **Add SSH keys**: let Oracle generate a key pair and **download the private key** (or
   paste your own public key if you already have one). You'll need this private key to log in.
5. Leave networking on the default VCN/subnet. Leave the rest as default and click **Create**.
6. Wait ~1 minute for it to reach the **Running** state, then copy its **Public IP address**.

## 3. Connect to the VM

From your local machine (PowerShell or Git Bash), using the private key you downloaded:

```bash
chmod 600 /path/to/downloaded-key.pem
ssh -i /path/to/downloaded-key.pem ubuntu@<PUBLIC_IP>
```

## 4. Install Node.js and git on the VM

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs git
node -v   # should print v22.x
```

## 5. Get the bot's code onto the VM

Easiest if the repo is pushed to GitHub (private repo is fine):

```bash
git clone <your-repo-url> ragnarok-guild-bot
cd ragnarok-guild-bot
npm install
```

If you'd rather not use GitHub, you can copy the folder directly from Windows instead:

```bash
# run this on your LOCAL machine, not the VM
scp -i /path/to/downloaded-key.pem -r "C:\Users\kitch\Downloads\ragnarok-guild-bot-phase1\ragnarok-guild-bot" ubuntu@<PUBLIC_IP>:~/ragnarok-guild-bot
```

## 6. Set up `.env` on the VM

```bash
cd ~/ragnarok-guild-bot
nano .env
```

Paste in the same values from your local `.env` (see `.env.example` for the full list —
`DISCORD_TOKEN`, `GOOGLE_SHEET_ID`, `GOOGLE_SERVICE_ACCOUNT_EMAIL`, `GOOGLE_PRIVATE_KEY`, all
the channel IDs, etc.). For `GOOGLE_PRIVATE_KEY`, keep it as a single line with `\n` escape
sequences exactly as it appears in your local `.env` — don't reformat it into a real multi-line
value. Save with `Ctrl+O`, `Enter`, then exit with `Ctrl+X`.

## 7. Register slash commands (one-time, or whenever commands change)

```bash
npm run deploy:commands
```

## 8. Run the bot permanently with pm2

`pm2` keeps the bot running, restarts it if it crashes, and can survive VM reboots.

```bash
sudo npm install -g pm2
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup systemd
```

That last command prints a `sudo env PATH=...` line — copy and run exactly what it prints (it
registers pm2 as a systemd service so the bot restarts automatically if the VM reboots).

## 9. Verify it's running

```bash
pm2 status              # should show ragnarok-guild-bot as "online"
pm2 logs ragnarok-guild-bot --lines 50
```

Check Discord — the bot should show as online, and slash commands should work.

## Updating the bot later

```bash
cd ~/ragnarok-guild-bot
git pull                # or re-upload via scp
npm install
pm2 restart ragnarok-guild-bot
```

## Useful pm2 commands

- `pm2 logs ragnarok-guild-bot` — live logs
- `pm2 restart ragnarok-guild-bot` — restart after a code/env change
- `pm2 stop ragnarok-guild-bot` — stop it
- `pm2 monit` — live CPU/memory dashboard
