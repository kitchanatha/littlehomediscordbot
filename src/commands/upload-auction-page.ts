import { ChatInputCommandInteraction, GuildMemberRoleManager } from "discord.js";
import { env } from "../config/env.js";

function isAdminInteraction(interaction: ChatInputCommandInteraction): boolean {
  const roles = interaction.member?.roles;
  return roles instanceof GuildMemberRoleManager
    ? env.ASSIGN_ROLE_IDS.some((roleId) => roles.cache.has(roleId))
    : Array.isArray(roles) && env.ASSIGN_ROLE_IDS.some((roleId) => roles.includes(roleId));
}

// Uploads a screenshot of the game's own Guild Auction list (up to 4 items stacked top to
// bottom) to the guild-item-reservation website's shared item catalog. queue-bridge asks
// Claude to read each row's item name off the image and records it against that row's fixed
// position on the page — no typing needed, unlike /upload_item_image's manual single-icon path.
// Same double authorization as that command: Discord admin-role gate here, BOT_SHARED_SECRET
// checked again server-side in the Edge Function.
export async function handleUploadAuctionPage(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!isAdminInteraction(interaction)) {
    await interaction.editReply("❌ You don't have permission to use this.\n❌ คุณไม่มีสิทธิ์ใช้คำสั่งนี้");
    return;
  }

  if (!env.SUPABASE_FUNCTIONS_URL || !env.SUPABASE_ANON_KEY || !env.BOT_SHARED_SECRET) {
    await interaction.editReply(
      "❌ This feature isn't configured yet — SUPABASE_FUNCTIONS_URL, SUPABASE_ANON_KEY, and BOT_SHARED_SECRET must all be set."
    );
    return;
  }

  const attachment = interaction.options.getAttachment("image", true);
  if (!attachment.contentType?.startsWith("image/")) {
    await interaction.editReply("❌ That attachment isn't an image.");
    return;
  }

  try {
    const imageRes = await fetch(attachment.url);
    if (!imageRes.ok) throw new Error(`failed to download attachment (${imageRes.status})`);
    const imageBuffer = Buffer.from(await imageRes.arrayBuffer());
    const imageBase64 = imageBuffer.toString("base64");

    const bridgeRes = await fetch(`${env.SUPABASE_FUNCTIONS_URL}/queue-bridge`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${env.SUPABASE_ANON_KEY}`,
        apikey: env.SUPABASE_ANON_KEY,
      },
      body: JSON.stringify({
        action: "upload_auction_page",
        imageBase64,
        contentType: attachment.contentType,
        botSecret: env.BOT_SHARED_SECRET,
        discordUserId: interaction.user.id,
      }),
    });

    const data = (await bridgeRes.json().catch(() => ({}))) as {
      error?: string;
      items?: { itemKey: string; displayName: string }[];
    };
    if (!bridgeRes.ok) throw new Error(data.error || `request failed (${bridgeRes.status})`);

    const names = (data.items ?? []).map((i) => i.displayName);
    const summary = names.length > 0 ? names.map((n) => `• ${n}`).join("\n") : "(none found)";
    await interaction.editReply(`✅ Added ${names.length} item(s) to the catalog:\n${summary}`);
    console.log(`INFO Auction page upload: ${names.join(", ")} by ${interaction.user.id}`);
  } catch (error) {
    console.error("ERROR upload_auction_page failed", error);
    await interaction.editReply("❌ Something went wrong. Please try again later.\n❌ เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง");
  }
}
