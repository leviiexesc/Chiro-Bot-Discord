import dotenv from "dotenv";
import http from "http";
import {
  Client,
  GatewayIntentBits,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  SlashCommandBuilder,
  REST,
  Routes,
  Interaction,
} from "discord.js";

dotenv.config();

const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN || "";
const CLIENT_ID = process.env.CLIENT_ID || "";
const API_BASE = (process.env.API_BASE || "https://chiro-license-center.onrender.com/api/v1/client").replace(/\/$/, "");
const PORT = Number(process.env.PORT) || 10000;

// Per-user language preference: userId -> "en" | "km"
const userLang = new Map<string, "en" | "km">();

function getLang(userId: string): "en" | "km" {
  return userLang.get(userId) ?? "en";
}

// ── HTTP Health Server for Render 24/7 ─────────────────────────────────────────
let botReady = false;
let botTag = "ChiroDiscordBot";

const healthServer = http.createServer((req, res) => {
  if (req.url === "/health" || req.url === "/") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        status: "healthy",
        service: "Chiro Discord Bot",
        bot: botReady ? botTag : "Waiting for DISCORD_BOT_TOKEN",
        discordConnected: botReady,
        uptime: Math.floor(process.uptime()),
        timestamp: new Date().toISOString(),
      })
    );
  } else {
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Not Found");
  }
});

healthServer.listen(PORT, () => {
  console.log(`🌐 Discord Bot Health server listening on port ${PORT}`);

  const SELF_URL = process.env.RENDER_EXTERNAL_URL
    ? `${process.env.RENDER_EXTERNAL_URL}/health`
    : `http://localhost:${PORT}/health`;

  setInterval(async () => {
    try {
      const res = await fetch(SELF_URL);
      console.log(`💓 Discord Bot Self-ping → ${SELF_URL} [${res.status}]`);
    } catch (err) {
      console.warn("⚠️ Self-ping failed:", err);
    }
  }, 14 * 60 * 1000);
});

// ── Discord Client Setup (Using GatewayIntentBits.Guilds only) ─────────────────
const client = new Client({
  intents: [GatewayIntentBits.Guilds],
});

// ── Role-based HWID Reset Cooldown Calculator ─────────────────────────────────
interface CooldownInfo {
  hours: number;
  roleName: string;
}

function getMemberCooldown(member: any): CooldownInfo {
  if (!member) {
    return { hours: 96, roleName: "👤 Default Member (4 Days)" };
  }

  const roleList = member.roles?.cache ? Array.from(member.roles.cache.values()) : [];
  const roleNames = roleList.map((r: any) => (r.name || "").toLowerCase());

  // 1. Chiro Hub VIP (Role named "Chiro Hub", "ChiroHub", or "VIP"): No Cooldown (0 Hours)
  const isChiroHub = roleNames.some(
    (n: string) => n.includes("chiro hub") || n.includes("chirohub") || n === "vip"
  );
  if (isChiroHub) {
    return { hours: 0, roleName: "🌟 Chiro Hub (No Cooldown)" };
  }

  // 2. Admin (Administrator permission or role containing "admin"): 1 Hour
  const isAdmin =
    member.permissions?.has("Administrator") ||
    roleNames.some((n: string) => n.includes("admin"));
  if (isAdmin) {
    return { hours: 1, roleName: "👑 Admin (1 Hour Cooldown)" };
  }

  // 3. Server Booster (Boosting or role containing "booster"): 1 Day (24 Hours)
  const isBooster =
    Boolean(member.premiumSince) ||
    roleNames.some((n: string) => n.includes("booster") || n.includes("nitro booster"));
  if (isBooster) {
    return { hours: 24, roleName: "🚀 Server Booster (1 Day Cooldown)" };
  }

  // 4. Default Member: 4 Days (96 Hours)
  return { hours: 96, roleName: "👤 Default Member (4 Days Cooldown)" };
}

// ── Auto-Grant Premium Role on Key Redeem ──────────────────────────────────────
async function grantPremiumRole(guild: any, member: any): Promise<string | null> {
  if (!guild || !member) return null;
  try {
    let role = guild.roles.cache.find(
      (r: any) =>
        r.name.toLowerCase() === "premium" ||
        r.name.toLowerCase() === "buyer" ||
        r.name.toLowerCase() === "customer"
    );

    if (!role) {
      try {
        role = await guild.roles.create({
          name: "Premium",
          color: 0x06b6d4, // Cyan
          reason: "Auto-created for Chiro UI Key Buyers",
        });
      } catch (createErr) {
        console.warn("Could not auto-create Premium role:", createErr);
      }
    }

    if (role && member.roles && "add" in member.roles) {
      await member.roles.add(role);
      return role.name;
    }
  } catch (err: any) {
    console.warn("Could not grant Premium role:", err.message);
  }
  return null;
}

// ── API Helper Functions ──────────────────────────────────────────────────────
async function redeemVoucherApi(code: string, discordId?: string, discordTag?: string) {
  try {
    const res = await fetch(`${API_BASE}/redeem`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, discordId, discordTag }),
    });
    return (await res.json()) as any;
  } catch (err: any) {
    return { success: false, error: { message: err?.message || "Failed to reach license server." } };
  }
}

async function verifyKeyApi(key: string) {
  try {
    const res = await fetch(`${API_BASE}/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key, hwid: "DISCORD_VERIFY_CHECK" }),
    });
    return (await res.json()) as any;
  } catch (err: any) {
    return { success: false, error: { message: err?.message || "Failed to reach license server." } };
  }
}

async function resetHwidApi(key: string, discordId?: string, cooldownHours?: number) {
  try {
    const res = await fetch(`${API_BASE}/reset-hwid`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key, discordId, cooldownHours }),
    });
    return (await res.json()) as any;
  } catch (err: any) {
    return { success: false, error: { message: err?.message || "Failed to reach license server." } };
  }
}

async function fetchMyKeysApi(discordId: string) {
  try {
    const res = await fetch(`${API_BASE}/my-keys?discordId=${discordId}`);
    return (await res.json()) as any;
  } catch {
    return { success: false, data: [] };
  }
}

// ── Member Panel Generator (Banana Hub Style) ─────────────────────────────────
function buildMemberPanel(lang: "en" | "km" = "en") {
  const isKm = lang === "km";

  const embed = new EmbedBuilder()
    .setColor(0x06b6d4) // Cyan
    .setTitle(isKm ? "⚡ Chiro UI — ផ្ទាំងសមាជិក (Member Panel)" : "⚡ Chiro UI — Member Panel")
    .setDescription(
      isKm
        ? `សូមស្វាគមន៍មកកាន់ **Chiro UI**!\n\nឧបករណ៍សម្រាប់សមាជិក។ ចុចលើប៊ូតុងខាងក្រោមដើម្បីជ្រើសរើស:\n\n` +
            `🎟️ **Redeem Code** — ប្ដូរ voucher យក whitelist key (ទទួលបាន role **@Premium** ស្វ័យប្រវត្តិ)\n` +
            `🆓 **Free 24h Key** — ទទួល link យក key ឥតគិតថ្លៃ 24 ម៉ោង\n` +
            `🖥️ **Reset HWID** — បង្ហាញ dropdown ជ្រើសរើស key ដើម្បី Reset HWID\n` +
            `📜 **Get Script / Keys** — បង្ហាញ dropdown ជ្រើសរើស key ដើម្បីទទួល Roblox loader\n` +
            `📊 **My Keys Status** — បង្ហាញ dropdown ពិនិត្យស្ថានភាព key នីមួយៗ\n` +
            `🌐 **Language / ភាសា** — ប្ដូរភាសារវាង English និង ខ្មែរ\n\n` +
            `⏳ **កម្រិតកំណត់ Reset HWID Cooldown:**\n` +
            `• 🌟 **Chiro Hub:** គ្មាន Cooldown (Reset បានរហ័សគ្រប់ពេល)\n` +
            `• 👑 **Admin:** Cooldown 1 ម៉ោង\n` +
            `• 🚀 **Server Booster:** Cooldown 1 ថ្ងៃ\n` +
            `• 👤 **សមាជិកទូទៅ:** Cooldown 4 ថ្ងៃ`
        : `Welcome to **Chiro UI**!\n\nTools for members. Click the corresponding button to use it.\n\n` +
            `🎟️ **Redeem Code** — redeem voucher code (automatically grants **@Premium** role)\n` +
            `🆓 **Free 24h Key** — get a free 24-hour key checkpoint link\n` +
            `🖥️ **Reset HWID** — dropdown menu to select a key to reset HWID\n` +
            `📜 **Get Script / Keys** — dropdown menu to choose key and get Roblox script\n` +
            `📊 **My Keys Status** — dropdown menu to view status & devices of your keys\n` +
            `🌐 **Language / ភាសា** — switch language to Khmer or English\n\n` +
            `⏳ **HWID Reset Cooldown Tiers:**\n` +
            `• 🌟 **Chiro Hub:** No Cooldown (Instant Unlimited)\n` +
            `• 👑 **Admin:** 1 Hour Cooldown\n` +
            `• 🚀 **Server Booster:** 1 Day Cooldown\n` +
            `• 👤 **Default Member:** 4 Days Cooldown`
    )
    .setFooter({ text: "Chiro UI • Member Panel • High Security Licensing" })
    .setTimestamp();

  // Row 1 Buttons
  const row1 = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId("btn_redeem")
      .setLabel("Redeem Code")
      .setEmoji("🎟️")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId("btn_free")
      .setLabel("Free 24h Key")
      .setEmoji("🆓")
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId("btn_resethwid")
      .setLabel("Reset HWID")
      .setEmoji("🖥️")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId("btn_script")
      .setLabel("Get Script / Keys")
      .setEmoji("📜")
      .setStyle(ButtonStyle.Secondary)
  );

  // Row 2 Buttons
  const row2 = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId("btn_verify")
      .setLabel("My Keys Status")
      .setEmoji("📊")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId("btn_lang")
      .setLabel(isKm ? "ភាសា (Khmer)" : "Language (EN)")
      .setEmoji("🌐")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId("btn_help")
      .setLabel(isKm ? "Help / ជំនួយ" : "Help")
      .setEmoji("ℹ️")
      .setStyle(ButtonStyle.Secondary)
  );

  return { embeds: [embed], components: [row1, row2] };
}

// ── Modals for Discord Inputs ─────────────────────────────────────────────────
function createRedeemModal(lang: "en" | "km") {
  const isKm = lang === "km";
  const modal = new ModalBuilder()
    .setCustomId("modal_redeem")
    .setTitle(isKm ? "ប្ដូរ Voucher Code" : "Redeem Purchase Voucher");

  const input = new TextInputBuilder()
    .setCustomId("voucher_input")
    .setLabel(isKm ? "Voucher Code របស់អ្នក:" : "Your Voucher Code:")
    .setPlaceholder("CHIRO-RA3H-RUEY-ESKF")
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMinLength(10)
    .setMaxLength(64);

  modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(input));
  return modal;
}

// ── Discord Interaction Handler ───────────────────────────────────────────────
client.on("interactionCreate", async (interaction: Interaction) => {
  try {
    const userId = interaction.user.id;
    const lang = getLang(userId);
    const isKm = lang === "km";

    // ─────────────────────────────────────────────────────────────────────────
    // 1. BUTTON INTERACTIONS
    // ─────────────────────────────────────────────────────────────────────────
    if (interaction.isButton()) {
      const btnId = interaction.customId;

      // 1. Redeem Code -> Opens Modal
      if (btnId === "btn_redeem") {
        await interaction.showModal(createRedeemModal(lang));
        return;
      }

      // 2. Free 24h Key -> Sends Ephemeral Checkpoint Link
      if (btnId === "btn_free") {
        const freeEmbed = new EmbedBuilder()
          .setColor(0x10b981)
          .setTitle(isKm ? "🆓 Key ឥតគិតថ្លៃ 24 ម៉ោង" : "🆓 Free 24-Hour Key")
          .setDescription(
            isKm
              ? `ទទួលបាន key ឥតគិតថ្លៃ 24 ម៉ោង ដោយបំពេញ 3 ជំហានរហ័ស:\n\n` +
                  `👉 **បើកទំព័រ Checkpoint Generator:**\n` +
                  `https://chiro-license-center.onrender.com/free-key\n\n` +
                  `1. បើក link ខាងលើ\n` +
                  `2. បំពេញ 3 ជំហាន (រង់ចាំ 15 វិនាទីនីមួយៗ)\n` +
                  `3. Copy key យកទៅប្រើភ្លាមៗ!`
              : `Generate a free 24-hour key by completing 3 quick checkpoints:\n\n` +
                  `👉 **Checkpoint Generator:**\n` +
                  `https://chiro-license-center.onrender.com/free-key\n\n` +
                  `1. Open the page above\n` +
                  `2. Complete 3 steps (15s wait each)\n` +
                  `3. Receive your free license key instantly!`
          )
          .setFooter({ text: "Only visible to you" });

        await interaction.reply({ embeds: [freeEmbed], ephemeral: true });
        return;
      }

      // 3. Reset HWID -> Dropdown Menu (BananaBot style!)
      if (btnId === "btn_resethwid") {
        await interaction.deferReply({ ephemeral: true });
        const res = await fetchMyKeysApi(userId);
        const keys = res?.data || [];

        if (keys.length === 0) {
          await interaction.editReply({
            content: isKm
              ? "❌ <b>មិនមាន Key ណាមួយត្រូវបានរកឃើញសម្រាប់គណនីរបស់អ្នកទេ។</b>\nសូមចុច <b>🎟️ Redeem Code</b> ដើម្បីប្ដូរ voucher ជាមុនសិន!"
              : "❌ **No redeemed keys found for your Discord account.**\nPlease tap **🎟️ Redeem Code** first to redeem a voucher!",
          });
          return;
        }

        const cooldown = getMemberCooldown(interaction.member);
        const cooldownMs = cooldown.hours * 60 * 60 * 1000;

        // Build Dropdown Options
        const selectMenu = new StringSelectMenuBuilder()
          .setCustomId("select_resethwid")
          .setPlaceholder(`Select a key to reset HWID | Page (1/1) 1-${keys.length}`);

        for (const k of keys.slice(0, 25)) {
          const durationStr = k.expiresAt
            ? `Expires: ${new Date(k.expiresAt).toLocaleDateString()}`
            : "Lifetime";

          let statusDesc = `(${durationStr}) | Ready to reset HWID`;
          let emoji = "🖥️";

          if (k.lastResetTimestamp && cooldownMs > 0) {
            const elapsed = Date.now() - k.lastResetTimestamp;
            if (elapsed < cooldownMs) {
              const remainingMs = cooldownMs - elapsed;
              const remHours = Math.ceil(remainingMs / (60 * 60 * 1000));
              const remDays = Math.ceil(remainingMs / (24 * 60 * 60 * 1000));
              const waitStr = remDays > 1 ? `${remDays}d` : `${remHours}h`;
              statusDesc = `(${durationStr}) | Cooldown: ${waitStr} left`;
              emoji = "⏳";
            }
          }

          selectMenu.addOptions(
            new StringSelectMenuOptionBuilder()
              .setLabel(k.key)
              .setDescription(statusDesc.substring(0, 100))
              .setEmoji(emoji)
              .setValue(k.key)
          );
        }

        const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(selectMenu);

        await interaction.editReply({
          content: isKm
            ? `🖥️ **សូមជ្រើសរើស Key ដែលអ្នកចង់ Reset HWID:**\n🛡️ *កម្រិតសិទ្ធិ: ${cooldown.roleName}*`
            : `🖥️ **Select a key to reset HWID from the dropdown below:**\n🛡️ *Your Cooldown Tier: ${cooldown.roleName}*`,
          components: [row],
        });
        return;
      }

      // 4. Get Script / Keys -> Dropdown Menu (BananaBot style!)
      if (btnId === "btn_script") {
        await interaction.deferReply({ ephemeral: true });
        const res = await fetchMyKeysApi(userId);
        const keys = res?.data || [];

        if (keys.length === 0) {
          // Default loader if no key redeemed yet
          const scriptEmbed = new EmbedBuilder()
            .setColor(0x3b82f6)
            .setTitle("📜 Roblox Execution Loader")
            .setDescription(
              "```lua\ngetgenv().Key = \"CHIRO_YOUR_KEY_HERE\"\nlocal Chiro = loadstring(game:HttpGet(\"https://raw.githubusercontent.com/leviiexesc/chiro_UI/main/chiro_lib.luau\"))()\n```\n" +
                "💡 *Tip: Redeem a key first to get a 1-click personalized script!*"
            );
          await interaction.editReply({ embeds: [scriptEmbed] });
          return;
        }

        const selectMenu = new StringSelectMenuBuilder()
          .setCustomId("select_script")
          .setPlaceholder(`Select a key to get Roblox script | Page (1/1) 1-${keys.length}`);

        for (const k of keys.slice(0, 25)) {
          const prodName = k.product?.name || "Chiro UI";
          const durStr = k.expiresAt ? "Temporary Key" : "Lifetime VIP";
          selectMenu.addOptions(
            new StringSelectMenuOptionBuilder()
              .setLabel(k.key)
              .setDescription(`(${durStr}) | ${prodName}`)
              .setEmoji("📜")
              .setValue(k.key)
          );
        }

        const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(selectMenu);

        await interaction.editReply({
          content: isKm
            ? "📜 **សូមជ្រើសរើស Key របស់អ្នកដើម្បីទទួលកូដ Roblox Loader:**"
            : "📜 **Select your key from the dropdown to get your personalized script loader:**",
          components: [row],
        });
        return;
      }

      // 5. My Keys Status -> Dropdown Menu (BananaBot style!)
      if (btnId === "btn_verify") {
        await interaction.deferReply({ ephemeral: true });
        const res = await fetchMyKeysApi(userId);
        const keys = res?.data || [];

        if (keys.length === 0) {
          await interaction.editReply({
            content: isKm
              ? "❌ **មិនមាន Key ណាមួយត្រូវបានរកឃើញសម្រាប់គណនីរបស់អ្នកទេ។**"
              : "❌ **No keys found for your account.**\nTap **🎟️ Redeem Code** to redeem a voucher!",
          });
          return;
        }

        const selectMenu = new StringSelectMenuBuilder()
          .setCustomId("select_status")
          .setPlaceholder(`Select a key to view details & status | Page (1/1) 1-${keys.length}`);

        for (const k of keys.slice(0, 25)) {
          const prodName = k.product?.name || "Chiro UI";
          const devCount = k._count?.devices ?? 0;
          selectMenu.addOptions(
            new StringSelectMenuOptionBuilder()
              .setLabel(k.key)
              .setDescription(`${prodName} | Status: ${k.status} | Devices: ${devCount}/${k.maxDevices}`)
              .setEmoji("📊")
              .setValue(k.key)
          );
        }

        const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(selectMenu);

        await interaction.editReply({
          content: isKm
            ? "📊 **ជ្រើសរើស Key ពី Dropdown ដើម្បីពិនិត្យព័ត៌មានលម្អិត:**"
            : "📊 **Select a key from the dropdown to inspect its full status & device slots:**",
          components: [row],
        });
        return;
      }

      // 6. Language Toggle Button
      if (btnId === "btn_lang") {
        const newLang = lang === "en" ? "km" : "en";
        userLang.set(userId, newLang);

        const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder()
            .setCustomId("lang_select_en")
            .setLabel("🇺🇸 English")
            .setStyle(newLang === "en" ? ButtonStyle.Primary : ButtonStyle.Secondary),
          new ButtonBuilder()
            .setCustomId("lang_select_km")
            .setLabel("🇰🇭 ខ្មែរ (Khmer)")
            .setStyle(newLang === "km" ? ButtonStyle.Primary : ButtonStyle.Secondary)
        );

        await interaction.reply({
          content:
            newLang === "km"
              ? "✅ ភាសាត្រូវបានប្ដូរទៅ **ខ្មែរ** 🇰🇭!"
              : "✅ Language set to **English** 🇺🇸!",
          components: [row],
          ephemeral: true,
        });
        return;
      }

      if (btnId === "lang_select_en" || btnId === "lang_select_km") {
        const chosen = btnId === "lang_select_en" ? "en" : "km";
        userLang.set(userId, chosen);
        await interaction.reply({
          content: chosen === "km" ? "✅ បានប្ដូរភាសាទៅ **ខ្មែរ** 🇰🇭" : "✅ Language set to **English** 🇺🇸",
          ephemeral: true,
        });
        return;
      }

      // 7. Help Button
      if (btnId === "btn_help") {
        const helpEmbed = new EmbedBuilder()
          .setColor(0x8b5cf6)
          .setTitle(isKm ? "📖 របៀបប្រើប្រាស់ Bot" : "📖 Chiro UI Bot Instructions")
          .setDescription(
            isKm
              ? `1️⃣ **ទិញ Key:** ទទួល voucher code (CHIRO-XXXX-XXXX-XXXX)\n` +
                  `2️⃣ **ប្ដូរ Key:** ចុចលើ \`🎟️ Redeem Code\` (ទទួលបាន role **@Premium** ភ្លាមៗ)\n` +
                  `3️⃣ **Execute ក្នុង Roblox:** ជ្រើសរើស key ក្នុង \`📜 Get Script / Keys\`\n` +
                  `4️⃣ **Reset HWID:** ជ្រើសរើស key ពី Dropdown \`🖥️ Reset HWID\`\n` +
                  `• 🌟 **Chiro Hub:** គ្មាន Cooldown\n` +
                  `• 👑 **Admin:** 1 ម៉ោង\n` +
                  `• 🚀 **Server Booster:** 1 ថ្ងៃ\n` +
                  `• 👤 **ទូទៅ:** 4 ថ្ងៃ`
              : `1️⃣ **Buy Key:** Purchase to receive a voucher (CHIRO-XXXX-XXXX-XXXX)\n` +
                  `2️⃣ **Redeem Key:** Click \`🎟️ Redeem Code\` (auto grants **@Premium** role)\n` +
                  `3️⃣ **Execute in Roblox:** Choose key from \`📜 Get Script / Keys\` dropdown\n` +
                  `4️⃣ **Reset HWID:** Choose key from \`🖥️ Reset HWID\` dropdown\n` +
                  `• 🌟 **Chiro Hub:** No Cooldown\n` +
                  `• 👑 **Admin:** 1 Hour\n` +
                  `• 🚀 **Server Booster:** 1 Day\n` +
                  `• 👤 **Default Member:** 4 Days`
          )
          .setFooter({ text: "Only visible to you" });

        await interaction.reply({ embeds: [helpEmbed], ephemeral: true });
        return;
      }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 2. DROPDOWN (SELECT MENU) INTERACTIONS
    // ─────────────────────────────────────────────────────────────────────────
    if (interaction.isStringSelectMenu()) {
      const selectedKey = interaction.values[0];

      // A. Dropdown: Reset HWID
      if (interaction.customId === "select_resethwid") {
        await interaction.deferReply({ ephemeral: true });
        const cooldown = getMemberCooldown(interaction.member);
        const res = await resetHwidApi(selectedKey, interaction.user.id, cooldown.hours);

        if (res && res.success) {
          const nextReset = res.data?.nextResetAvailable
            ? (res.data.nextResetAvailable.startsWith("Immediately")
                ? res.data.nextResetAvailable
                : new Date(res.data.nextResetAvailable).toLocaleDateString(isKm ? "km-KH" : "en-GB", {
                    day: "2-digit",
                    month: "short",
                    year: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                  }))
            : "4 days from now";

          const hwidEmbed = new EmbedBuilder()
            .setColor(0x10b981)
            .setTitle(isKm ? "✅ Reset HWID បានជោគជ័យ!" : "✅ HWID Reset Successful!")
            .setDescription(
              isKm
                ? `Key \`${selectedKey}\` ត្រូវបានដោះចំណងពីឧបករណ៍ទាំងអស់។\n\n` +
                    `🛡️ **កម្រិតសិទ្ធិ Cooldown:** ${cooldown.roleName}\n` +
                    `📱 អ្នកអាចយកទៅ activate លើឧបករណ៍ថ្មីបានហើយ។\n` +
                    `⏳ **Reset បន្ទាប់អាចធ្វើបាននៅ:** ${nextReset}`
                : `Your key \`${selectedKey}\` has been unlinked from all previous devices.\n\n` +
                    `🛡️ **Cooldown Tier:** ${cooldown.roleName}\n` +
                    `📱 You can now execute and activate it on your new device.\n` +
                    `⏳ **Next reset available:** ${nextReset}`
            );

          await interaction.editReply({ embeds: [hwidEmbed], components: [] });
        } else {
          const err = res?.error?.message || (isKm ? "ការ Reset HWID បរាជ័យ។" : "HWID Reset failed.");
          await interaction.editReply({
            content: `❌ **${isKm ? "Reset HWID បរាជ័យ" : "HWID Reset Failed"}**\n\n${err}\n\n💡 *Tier: ${cooldown.roleName}*`,
            components: [],
          });
        }
        return;
      }

      // B. Dropdown: Get Script
      if (interaction.customId === "select_script") {
        const scriptEmbed = new EmbedBuilder()
          .setColor(0x3b82f6)
          .setTitle("📜 Roblox Script Loader")
          .setDescription(
            `Execution script for key \`${selectedKey}\`:\n\n` +
              `\`\`\`lua\n` +
              `getgenv().Key = "${selectedKey}"\n` +
              `local Chiro = loadstring(game:HttpGet("https://raw.githubusercontent.com/leviiexesc/chiro_UI/main/chiro_lib.luau"))()\n` +
              `\`\`\`\n` +
              `📋 *Tap the copy button on the code block above to copy directly into your executor!*`
          )
          .setFooter({ text: "Only visible to you" });

        await interaction.reply({ embeds: [scriptEmbed], ephemeral: true });
        return;
      }

      // C. Dropdown: My Keys Status
      if (interaction.customId === "select_status") {
        await interaction.deferReply({ ephemeral: true });
        const res = await verifyKeyApi(selectedKey);

        if (res && res.success && res.data) {
          const d = res.data;
          const status = d.status || "ACTIVE";
          const prodName = d.product?.name || "Chiro UI";
          const exp = d.license?.expiresAt
            ? new Date(d.license.expiresAt).toLocaleDateString(isKm ? "km-KH" : "en-GB")
            : isKm
            ? "គ្មានកំណត់"
            : "Lifetime VIP";
          const devices = `${d.license?.currentDevices || 0}/${d.license?.maxDevices || 1}`;

          const verifyEmbed = new EmbedBuilder()
            .setColor(0x10b981)
            .setTitle(isKm ? "✅ ព័ត៌មានលម្អិត License Key" : "✅ License Key Details")
            .setDescription(
              `🔑 **Key:** \`${selectedKey}\`\n\n` +
                `📦 **${isKm ? "ផលិតផល" : "Product"}:** ${prodName}\n` +
                `🟢 **${isKm ? "ស្ថានភាព" : "Status"}:** ${status}\n` +
                `⏳ **${isKm ? "ផុតកំណត់" : "Expires"}:** ${exp}\n` +
                `📱 **${isKm ? "ឧបករណ៍ចូលភ្ជាប់" : "Devices Bound"}:** ${devices}`
            )
            .setFooter({ text: "Only visible to you" });

          await interaction.editReply({ embeds: [verifyEmbed], components: [] });
        } else {
          const err = res?.error?.message || (isKm ? "Key មិនត្រឹមត្រូវ។" : "Key not found or invalid.");
          await interaction.editReply({
            content: `❌ **${isKm ? "ពិនិត្យ Key បរាជ័យ" : "Verification Failed"}**\n\n${err}`,
            components: [],
          });
        }
        return;
      }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 3. MODAL SUBMISSIONS (Redeem Code)
    // ─────────────────────────────────────────────────────────────────────────
    if (interaction.isModalSubmit()) {
      await interaction.deferReply({ ephemeral: true });

      if (interaction.customId === "modal_redeem") {
        const code = interaction.fields.getTextInputValue("voucher_input").trim();
        const res = await redeemVoucherApi(code, interaction.user.id, interaction.user.tag);

        if (res && res.success && res.data) {
          const data = res.data;
          const dur = data.durationDays
            ? `${data.durationDays} ${isKm ? "ថ្ងៃ" : "Days"}`
            : "Lifetime VIP";

          // Auto-grant Premium role to buyer upon successful redeem
          let roleGrantedText = "";
          if (interaction.guild && interaction.member) {
            const roleName = await grantPremiumRole(interaction.guild, interaction.member);
            if (roleName) {
              roleGrantedText = isKm
                ? `\n\n👑 **តួនាទីទទួលបាន:** អ្នកទទួលបានតួនាទី **@${roleName}**!`
                : `\n\n👑 **Role Granted:** You have been assigned the **@${roleName}** role!`;
            }
          }

          const successEmbed = new EmbedBuilder()
            .setColor(0x10b981)
            .setTitle(isKm ? "🎉 Voucher ត្រូវបានប្ដូរជោគជ័យ!" : "🎉 Voucher Redeemed Successfully!")
            .setDescription(
              (isKm
                ? `📦 **ផលិតផល:** ${data.product?.name || "Chiro UI"}\n` +
                    `⏳ **រយៈពេល:** ${dur}\n` +
                    `📱 **ចំនួនឧបករណ៍:** ${data.maxDevices || 1}\n\n` +
                    `🔑 **Script Key សុវត្ថិភាពរបស់អ្នក:**\n` +
                    `\`\`\`\n${data.key}\n\`\`\`\n` +
                    `📋 **របៀប Execute ក្នុង Roblox:**\n` +
                    `\`\`\`lua\n` +
                    `getgenv().Key = "${data.key}"\n` +
                    `local Chiro = loadstring(game:HttpGet("https://raw.githubusercontent.com/leviiexesc/chiro_UI/main/chiro_lib.luau"))()\n` +
                    `\`\`\`\n` +
                    `⚠️ *សំខាន់:* សូមកត់ទុក key នេះ! Voucher ដើមត្រូវបានប្រើប្រាស់រួចហើយ។`
                : `📦 **Product:** ${data.product?.name || "Chiro UI"}\n` +
                    `⏳ **Duration:** ${dur}\n` +
                    `📱 **Device Slots:** ${data.maxDevices || 1}\n\n` +
                    `🔑 **Your High-Security Script Key:**\n` +
                    `\`\`\`\n${data.key}\n\`\`\`\n` +
                    `📋 **How to execute in Roblox:**\n` +
                    `\`\`\`lua\n` +
                    `getgenv().Key = "${data.key}"\n` +
                    `local Chiro = loadstring(game:HttpGet("https://raw.githubusercontent.com/leviiexesc/chiro_UI/main/chiro_lib.luau"))()\n` +
                    `\`\`\`\n` +
                    `⚠️ *Important:* Save your key! Your original purchase voucher code is now consumed.`) +
                roleGrantedText
            )
            .setFooter({ text: "Keep your key private • Only visible to you" });

          await interaction.editReply({ embeds: [successEmbed] });
        } else {
          const err =
            res?.error?.message ||
            (isKm
              ? "Voucher code មិនត្រឹមត្រូវ ឬត្រូវបានប្ដូររួចហើយ។"
              : "Invalid or already redeemed voucher code.");
          await interaction.editReply({
            content: `❌ **${isKm ? "ការប្ដូរ Voucher បរាជ័យ" : "Redeem Failed"}**\n\n${err}`,
          });
        }
        return;
      }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 4. SLASH COMMANDS (/panel)
    // ─────────────────────────────────────────────────────────────────────────
    if (interaction.isChatInputCommand()) {
      if (interaction.commandName === "panel") {
        const panel = buildMemberPanel(lang);
        await interaction.reply(panel);
        return;
      }
    }
  } catch (err) {
    console.error("Interaction error:", err);
  }
});

// ── Register Slash Commands ───────────────────────────────────────────────────
async function registerSlashCommands() {
  if (!DISCORD_BOT_TOKEN || !CLIENT_ID) return;

  const commands = [
    new SlashCommandBuilder()
      .setName("panel")
      .setDescription("Post the Chiro UI Member Panel with interactive buttons"),
  ].map((c) => c.toJSON());

  const rest = new REST({ version: "10" }).setToken(DISCORD_BOT_TOKEN);

  try {
    console.log("📡 Registering Discord Slash commands...");
    await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
    console.log("✅ Discord Slash commands registered successfully.");
  } catch (err) {
    console.warn("⚠️ Could not register slash commands (verify CLIENT_ID and BOT_TOKEN):", err);
  }
}

// ── Bot Startup ───────────────────────────────────────────────────────────────
client.once("ready", async () => {
  botReady = true;
  botTag = client.user?.tag || "ChiroDiscordBot";
  console.log(`
  🤖 ========================================================
  ⚡ CHIRO DISCORD LICENSE BOT READY
  👤 Bot Tag: ${botTag}
  🔗 API Base: ${API_BASE}
  📋 Member Panel: Run /panel to spawn menu
  📱 Dropdowns: Reset HWID, Get Script, My Keys Status
  👑 Auto-Role: Assigns @Premium on voucher redeem
  ⏳ Cooldowns: Chiro Hub (0h) | Admin (1h) | Booster (24h) | Default (96h)
  ========================================================
  `);

  await registerSlashCommands();
});

if (DISCORD_BOT_TOKEN && DISCORD_BOT_TOKEN.trim() !== "" && !DISCORD_BOT_TOKEN.includes("your_")) {
  client.login(DISCORD_BOT_TOKEN).catch((err) => {
    console.error("❌ Failed to login to Discord:", err.message);
  });
} else {
  console.log("ℹ️ DISCORD_BOT_TOKEN is not configured yet.");
  console.log("👉 Set DISCORD_BOT_TOKEN and CLIENT_ID in Render Environment to activate the bot.");
}
