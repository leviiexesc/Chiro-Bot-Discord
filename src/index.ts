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
  SlashCommandBuilder,
  REST,
  Routes,
  Interaction,
  Message,
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

  // 14-minute self-ping to prevent Render Free Plan sleeping
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

// ── Discord Client Setup ──────────────────────────────────────────────────────
// Using GatewayIntentBits.Guilds only so the bot connects without needing privileged intents
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
  ],
});


// ── API Helper Functions ──────────────────────────────────────────────────────
async function redeemVoucherApi(code: string, discordId?: string, discordTag?: string) {
  try {
    const res = await fetch(`${API_BASE}/redeem`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        code,
        telegramId: discordId,
        telegramUsername: discordTag,
      }),
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

async function resetHwidApi(key: string) {
  try {
    const res = await fetch(`${API_BASE}/reset-hwid`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key }),
    });
    return (await res.json()) as any;
  } catch (err: any) {
    return { success: false, error: { message: err?.message || "Failed to reach license server." } };
  }
}

// ── Member Panel Generator (Like Banana Hub in user image) ─────────────────────
function buildMemberPanel(lang: "en" | "km" = "en") {
  const isKm = lang === "km";

  const embed = new EmbedBuilder()
    .setColor(0x06b6d4) // Cyan
    .setTitle(isKm ? "⚡ Chiro UI — ផ្ទាំងសមាជិក (Member Panel)" : "⚡ Chiro UI — Member Panel")
    .setDescription(
      isKm
        ? `សូមស្វាគមន៍មកកាន់ **Chiro UI**!\n\nឧបករណ៍សម្រាប់សមាជិក។ ចុចលើប៊ូតុងខាងក្រោមដើម្បីប្រើប្រាស់:\n\n` +
            `🎟️ **Redeem Code** — ប្ដូរ voucher code ទៅជា whitelist script key\n` +
            `🆓 **Free 24h Key** — ទទួល link យក key ឥតគិតថ្លៃ 24 ម៉ោង\n` +
            `🖥️ **Reset HWID** — ដោះចំណងឧបករណ៍សម្រាប់ key របស់អ្នក *(4 ថ្ងៃម្ដង)*\n` +
            `📜 **Get Script / Keys** — ទទួល code loader សម្រាប់ run ក្នុង Roblox\n` +
            `📊 **My Keys Status** — ពិនិត្យស្ថានភាព key និងចំនួនឧបករណ៍\n` +
            `🌐 **Language / ភាសា** — ប្ដូរភាសារវាង English និង ខ្មែរ`
        : `Welcome to **Chiro UI**!\n\nTools for members. Click the corresponding button to use it.\n\n` +
            `🎟️ **Redeem Code** — redeem a code to get a whitelist key\n` +
            `🆓 **Free 24h Key** — get a free 24-hour temporary key\n` +
            `🖥️ **Reset HWID** — reset HWID for your key *(4-day cooldown)*\n` +
            `📜 **Get Script / Keys** — get Roblox script loader and execution key\n` +
            `📊 **My Keys Status** — view your key status & bound devices\n` +
            `🌐 **Language / ភាសា** — switch language to Khmer or English`
    )
    .setFooter({ text: "Chiro UI • Member Panel • High Security Licensing" })
    .setTimestamp();

  // Row 1 Buttons
  const row1 = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId("btn_redeem")
      .setLabel(isKm ? "Redeem Code" : "Redeem Code")
      .setEmoji("🎟️")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId("btn_free")
      .setLabel(isKm ? "Free 24h Key" : "Free 24h Key")
      .setEmoji("🆓")
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId("btn_resethwid")
      .setLabel(isKm ? "Reset HWID" : "Reset HWID")
      .setEmoji("🖥️")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId("btn_script")
      .setLabel(isKm ? "Get Script / Keys" : "Get Script / Keys")
      .setEmoji("📜")
      .setStyle(ButtonStyle.Secondary)
  );

  // Row 2 Buttons
  const row2 = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId("btn_verify")
      .setLabel(isKm ? "My Keys Status" : "My Keys Status")
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

function createResetHwidModal(lang: "en" | "km") {
  const isKm = lang === "km";
  const modal = new ModalBuilder()
    .setCustomId("modal_resethwid")
    .setTitle(isKm ? "Reset HWID ឧបករណ៍" : "Reset HWID");

  const input = new TextInputBuilder()
    .setCustomId("hwid_key_input")
    .setLabel(isKm ? "Script Key របស់អ្នក (CHIRO_...):" : "Your Script Key (CHIRO_...):")
    .setPlaceholder("CHIRO_7d672a9d2743ddd3b50c2710")
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMinLength(15)
    .setMaxLength(64);

  modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(input));
  return modal;
}

function createVerifyModal(lang: "en" | "km") {
  const isKm = lang === "km";
  const modal = new ModalBuilder()
    .setCustomId("modal_verify")
    .setTitle(isKm ? "ពិនិត្យស្ថានភាព License Key" : "Verify License Key");

  const input = new TextInputBuilder()
    .setCustomId("verify_key_input")
    .setLabel(isKm ? "Script Key របស់អ្នក:" : "Your Script Key:")
    .setPlaceholder("CHIRO_7d672a9d2743ddd3b50c2710")
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMinLength(15)
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

    // ── Button Interactions ──────────────────────────────────────────────────
    if (interaction.isButton()) {
      const btnId = interaction.customId;

      // 1. Redeem Button -> Show Modal
      if (btnId === "btn_redeem") {
        await interaction.showModal(createRedeemModal(lang));
        return;
      }

      // 2. Reset HWID Button -> Show Modal
      if (btnId === "btn_resethwid") {
        await interaction.showModal(createResetHwidModal(lang));
        return;
      }

      // 3. Verify Button -> Show Modal
      if (btnId === "btn_verify") {
        await interaction.showModal(createVerifyModal(lang));
        return;
      }

      // 4. Free Key Button -> Send Ephemeral Link
      if (btnId === "btn_free") {
        const freeEmbed = new EmbedBuilder()
          .setColor(0x10b981) // Green
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

      // 5. Get Script / Loader
      if (btnId === "btn_script") {
        const scriptEmbed = new EmbedBuilder()
          .setColor(0x3b82f6) // Blue
          .setTitle(isKm ? "📜 Code Loader សម្រាប់ Roblox" : "📜 Roblox Execution Loader")
          .setDescription(
            isKm
              ? `ដាក់កូដខាងក្រោមនេះនៅកំពូល executor របស់អ្នក:\n\n` +
                  `\`\`\`lua\n` +
                  `getgenv().Key = "CHIRO_YOUR_KEY_HERE"\n` +
                  `local Chiro = loadstring(game:HttpGet("https://raw.githubusercontent.com/leviiexesc/chiro_UI/main/chiro_lib.luau"))()\n` +
                  `\`\`\`\n` +
                  `💡 *ចំណាំ:* ប្ដូរ \`CHIRO_YOUR_KEY_HERE\` ជាមួយ key ពិតប្រាកដរបស់អ្នក។`
              : `Put this code at the very top of your Roblox script executor:\n\n` +
                  `\`\`\`lua\n` +
                  `getgenv().Key = "CHIRO_YOUR_KEY_HERE"\n` +
                  `local Chiro = loadstring(game:HttpGet("https://raw.githubusercontent.com/leviiexesc/chiro_UI/main/chiro_lib.luau"))()\n` +
                  `\`\`\`\n` +
                  `💡 *Note:* Replace \`CHIRO_YOUR_KEY_HERE\` with your redeemed script key.`
          )
          .setFooter({ text: "Only visible to you" });

        await interaction.reply({ embeds: [scriptEmbed], ephemeral: true });
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

      // Language switcher inline buttons
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
                  `2️⃣ **ប្ដូរ Key:** ចុចលើ \`🎟️ Redeem Code\` រួចបញ្ចូល code\n` +
                  `3️⃣ **Execute ក្នុង Roblox:** ប្រើ loader ក្នុង \`📜 Get Script / Keys\`\n` +
                  `4️⃣ **ប្ដូរទូរស័ព្ទ / PC:** ចុចលើ \`🖥️ Reset HWID\` (4 ថ្ងៃម្ដង)`
              : `1️⃣ **Buy Key:** Purchase to receive a voucher (CHIRO-XXXX-XXXX-XXXX)\n` +
                  `2️⃣ **Redeem Key:** Click \`🎟️ Redeem Code\` and submit code\n` +
                  `3️⃣ **Execute in Roblox:** Use the loader from \`📜 Get Script / Keys\`\n` +
                  `4️⃣ **Change Device:** Click \`🖥️ Reset HWID\` (4-day cooldown)`
          )
          .setFooter({ text: "Only visible to you" });

        await interaction.reply({ embeds: [helpEmbed], ephemeral: true });
        return;
      }
    }

    // ── Modal Form Submissions ───────────────────────────────────────────────
    if (interaction.isModalSubmit()) {
      await interaction.deferReply({ ephemeral: true });

      // Modal: Redeem Code
      if (interaction.customId === "modal_redeem") {
        const code = interaction.fields.getTextInputValue("voucher_input").trim();
        const res = await redeemVoucherApi(code, interaction.user.id, interaction.user.tag);

        if (res && res.success && res.data) {
          const data = res.data;
          const dur = data.durationDays
            ? `${data.durationDays} ${isKm ? "ថ្ងៃ" : "Days"}`
            : "Lifetime VIP";

          const successEmbed = new EmbedBuilder()
            .setColor(0x10b981) // Green
            .setTitle(isKm ? "🎉 Voucher ត្រូវបានប្ដូរជោគជ័យ!" : "🎉 Voucher Redeemed Successfully!")
            .setDescription(
              isKm
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
                    `⚠️ *Important:* Save your key! Your original purchase voucher code is now consumed.`
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

      // Modal: Reset HWID
      if (interaction.customId === "modal_resethwid") {
        const key = interaction.fields.getTextInputValue("hwid_key_input").trim();
        const res = await resetHwidApi(key);

        if (res && res.success) {
          const nextReset = res.data?.nextResetAvailable
            ? new Date(res.data.nextResetAvailable).toLocaleDateString(isKm ? "km-KH" : "en-GB", {
                day: "2-digit",
                month: "short",
                year: "numeric",
              })
            : "4 days from now";

          const hwidEmbed = new EmbedBuilder()
            .setColor(0x10b981)
            .setTitle(isKm ? "✅ Reset HWID បានជោគជ័យ!" : "✅ HWID Reset Successful!")
            .setDescription(
              isKm
                ? `Key \`${key}\` ត្រូវបានដោះចំណងពីឧបករណ៍ទាំងអស់។\n\n` +
                    `📱 អ្នកអាចយកទៅ activate លើឧបករណ៍ថ្មីបានហើយ។\n` +
                    `⏳ **Reset បន្ទាប់អាចធ្វើបាននៅ:** ${nextReset}`
                : `Your key \`${key}\` has been unlinked from all previous devices.\n\n` +
                    `📱 You can now execute and activate it on your new device.\n` +
                    `⏳ **Next reset available:** ${nextReset}`
            );

          await interaction.editReply({ embeds: [hwidEmbed] });
        } else {
          const err = res?.error?.message || (isKm ? "ការ Reset HWID បរាជ័យ។" : "HWID Reset failed.");
          await interaction.editReply({
            content: `❌ **${isKm ? "Reset HWID បរាជ័យ" : "HWID Reset Failed"}**\n\n${err}`,
          });
        }
        return;
      }

      // Modal: Verify Key
      if (interaction.customId === "modal_verify") {
        const key = interaction.fields.getTextInputValue("verify_key_input").trim();
        const res = await verifyKeyApi(key);

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
            .setTitle(isKm ? "✅ LICENSE ត្រឹមត្រូវ" : "✅ LICENSE VALID")
            .setDescription(
              `📦 **${isKm ? "ផលិតផល" : "Product"}:** ${prodName}\n` +
                `🟢 **${isKm ? "ស្ថានភាព" : "Status"}:** ${status}\n` +
                `⏳ **${isKm ? "ផុតកំណត់" : "Expires"}:** ${exp}\n` +
                `📱 **${isKm ? "ឧបករណ៍ចូលភ្ជាប់" : "Devices Bound"}:** ${devices}`
            );

          await interaction.editReply({ embeds: [verifyEmbed] });
        } else {
          const err = res?.error?.message || (isKm ? "Key មិនត្រឹមត្រូវ។" : "Key not found or invalid.");
          await interaction.editReply({
            content: `❌ **${isKm ? "ពិនិត្យ Key បរាជ័យ" : "Verification Failed"}**\n\n${err}`,
          });
        }
        return;
      }
    }

    // ── Slash Commands ───────────────────────────────────────────────────────
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
  📋 Member Panel: Run !panel or /panel to spawn menu
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
