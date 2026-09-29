import { ChatInputCommandInteraction, GuildMemberRoleManager } from "discord.js";
import { env } from "../config/env.js";

function isAdminInteraction(interaction: ChatInputCommandInteraction): boolean {
  const roles = interaction.member?.roles;
  return roles instanceof GuildMemberRoleManager
    ? env.ASSIGN_ROLE_IDS.some((roleId) => roles.cache.has(roleId))
    : Array.isArray(roles) && env.ASSIGN_ROLE_IDS.some((roleId) => roles.includes(roleId));
}

// Shares the item catalog (name + icon) with the guild-item-reservation website: both write to
// the same Supabase table/Storage bucket through that project's queue-bridge Edge Function, so
// an item uploaded here shows up there and vice versa. Discord's admin-role check above is the
// first gate; the Edge Function checks BOT_SHARED_SECRET again server-side rather than trusting
// this bot alone (same reasoning as the website's own IGN-based admin check on that side).
export async function handleUploadItemImage(interaction: ChatInputCommandInteraction): Promise<void> {
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

  const itemName = interaction.options.getString("name", true).trim();
  const attachment = interaction.options.getAttachment("image", true);

  if (!itemName) {
    await interaction.editReply("❌ Item name can't be empty.");
    return;
  }
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
        action: "upload_item_image",
        itemName,
        imageBase64,
        contentType: attachment.contentType,
        botSecret: env.BOT_SHARED_SECRET,
        discordUserId: interaction.user.id,
      }),
    });

    const data = (await bridgeRes.json().catch(() => ({}))) as { error?: string; imageUrl?: string };
    if (!bridgeRes.ok) throw new Error(data.error || `request failed (${bridgeRes.status})`);

    await interaction.editReply(`✅ Added **${itemName}** to the item catalog. It'll show up on the reservation site too.`);
    console.log(`INFO Item catalog upload: ${itemName} by ${interaction.user.id}`);
  } catch (error) {
    console.error("ERROR upload_item_image failed", error);
    await interaction.editReply("❌ Something went wrong. Please try again later.\n❌ เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง");
  }
}
