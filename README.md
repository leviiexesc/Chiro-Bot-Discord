# ⚡ Chiro UI — Discord License Bot

A modern, high-security Discord bot for the **Chiro UI License Center**, inspired by top Roblox script hubs like Banana Hub.

Features an **Interactive Member Panel** with Discord ActionRow buttons and Pop-up Modals for easy 1-click license management directly inside your Discord server.

---

## 📸 Member Panel Preview (Like Banana Hub)

```
⚡ Chiro UI — Member Panel
Welcome to Chiro UI!
Tools for members. Click the corresponding button to use it.

🎟️ Redeem Code — redeem a code to get a whitelist key
🆓 Free 24h Key — get a free 24-hour key link
🖥️ Reset HWID — reset HWID for your key (4-day cooldown)
📜 Get Script / Keys — get Roblox script loader and execution key
📊 My Keys Status — view your key status & bound devices
🌐 Language / ភាសា — switch language to Khmer or English

[🎟️ Redeem Code]  [🆓 Free 24h Key]  [🖥️ Reset HWID]  [📜 Get Script / Keys]
[📊 My Keys Status]  [🌐 ភាសា (Khmer)]  [ℹ️ Help / ជំនួយ]
```

---

## ✨ Features

- **🎟️ Redeem Code:** Clicking this opens a pop-up **Modal** asking for the purchase voucher (`CHIRO-XXXX-XXXX-XXXX`). Once submitted, the bot responds **ephemerally** (only visible to that user) with their high-security script key (`CHIRO_xxxx...`) and loader!
- **🆓 Free 24h Key:** Sends a private link to the 3-step Lootlabs checkpoint generator.
- **🖥️ Reset HWID:** Modal input for script key. Resets device bindings with automatic **4-day cooldown**.
- **📜 Get Script / Keys:** Provides the ready-to-run Roblox Lua loader script with 1-click copy block.
- **📊 My Keys Status:** Verifies key status, product name, expiration date, and active device count.
- **🌐 Bilingual (Khmer 🇰🇭 / English 🇺🇸):** Toggles language for all buttons and modal responses.
- **🔒 Privacy First:** All button responses are `ephemeral` — only the user who clicked can see their keys.
- **🌐 24/7 Render Keep-Alive:** Lightweight HTTP health server on port 10000 with a 14-minute self-ping so Render never idles it to sleep.

---

## 🚀 Setup Guide

### Step 1: Create Your Discord Bot
1. Go to the [Discord Developer Portal](https://discord.com/developers/applications).
2. Click **New Application**, name it (e.g. `Chiro License Bot`), and click **Create**.
3. Copy the **Application ID** (this is your `CLIENT_ID`).
4. Go to the **Bot** tab on the left:
   - Click **Reset Token** and copy your **Token** (this is your `DISCORD_BOT_TOKEN`).
   - Scroll down to **Privileged Gateway Intents** and enable:
     - ✅ **Message Content Intent**
   - Click **Save Changes**.

### Step 2: Invite the Bot to Your Server
1. In the Developer Portal, go to **OAuth2** → **URL Generator**.
2. Select scopes:
   - ✅ `bot`
   - ✅ `applications.commands`
3. Select Bot Permissions:
   - ✅ `Send Messages`
   - ✅ `Embed Links`
   - ✅ `Attach Files`
   - ✅ `Read Message History`
   - ✅ `Use Slash Commands`
4. Copy the generated URL at the bottom, paste it into your browser, and invite the bot to your Discord server.

### Step 3: Spawn the Member Panel
In any channel where you want the panel:
- Type **`/panel`** or **`!panel`** (requires *Manage Server* or *Administrator* permission).
- The bot will post the beautiful Member Panel embed with all interactive buttons!

---

## 🌐 Deploy to Render (Singapore Free Plan)

1. Create a new GitHub repository named `Chiro-Discord-Bot`.
2. Push this folder to GitHub.
3. On [Render](https://render.com), click **New +** → **Blueprint** or **Web Service**.
4. Set Environment Variables:
   - `DISCORD_BOT_TOKEN`: Your bot token from Step 1
   - `CLIENT_ID`: Your Application ID from Step 1
   - `API_BASE`: `https://chiro-license-center.onrender.com/api/v1/client`
   - `PORT`: `10000`
5. Deploy! The health server keeps it online 24/7.
