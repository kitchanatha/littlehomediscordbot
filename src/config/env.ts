import "dotenv/config";
import { z } from "zod";

const schema = z.object({
  DISCORD_TOKEN: z.string().min(1),
  DISCORD_CLIENT_ID: z.string().min(1),
  DISCORD_GUILD_ID: z.string().min(1),
  GOOGLE_SHEET_ID: z.string().min(1),
  GOOGLE_SERVICE_ACCOUNT_EMAIL: z.string().email(),
  GOOGLE_PRIVATE_KEY: z.string().min(1),
  ASSIGN_ROLE_IDS: z.string().min(1),
  ENABLE_MEMBERS_INTENT: z.string().optional().default("false"),
  // Voice channel(s) members join during Sunday War; joining one auto-marks attendance.
  // Comma-separated, e.g. "1535489015187513354,1535489924231462973". Leave blank to disable.
  WAR_CHECKIN_VOICE_CHANNEL_IDS: z.string().optional().default(""),
  // Text channel where /war_leave is allowed. Leave blank to allow it anywhere.
  WAR_LEAVE_CHANNEL_ID: z.string().optional().default(""),
  // Text channel where members post their registration form as a plain message; the bot
  // auto-registers them from it. Requires the "Message Content Intent" to be enabled in the
  // Discord Developer Portal. Leave blank to disable.
  AUTO_REGISTER_CHANNEL_ID: z.string().optional().default(""),
  // Text channel where a registered member leaving the Discord server is announced.
  // Leave blank to disable.
  MEMBER_UPDATE_CHANNEL_ID: z.string().optional().default(""),
  // Text channel where members post a name/class change request as a plain message; the bot
  // applies it to their own registered profile automatically. Requires "Message Content
  // Intent" in the Discord Developer Portal. Leave blank to disable.
  NAME_CLASS_CHANGE_CHANNEL_ID: z.string().optional().default(""),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error("Missing or invalid environment variables:", parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = {
  ...parsed.data,
  GOOGLE_PRIVATE_KEY: parsed.data.GOOGLE_PRIVATE_KEY.replace(/\\n/g, "\n"),
  ASSIGN_ROLE_IDS: parsed.data.ASSIGN_ROLE_IDS.split(",").map((id) => id.trim()).filter(Boolean),
  ENABLE_MEMBERS_INTENT: parsed.data.ENABLE_MEMBERS_INTENT === "true",
  WAR_CHECKIN_VOICE_CHANNEL_IDS: parsed.data.WAR_CHECKIN_VOICE_CHANNEL_IDS.split(",").map((id) => id.trim()).filter(Boolean),
  WAR_LEAVE_CHANNEL_ID: parsed.data.WAR_LEAVE_CHANNEL_ID.trim(),
  AUTO_REGISTER_CHANNEL_ID: parsed.data.AUTO_REGISTER_CHANNEL_ID.trim(),
  MEMBER_UPDATE_CHANNEL_ID: parsed.data.MEMBER_UPDATE_CHANNEL_ID.trim(),
  NAME_CLASS_CHANGE_CHANNEL_ID: parsed.data.NAME_CLASS_CHANGE_CHANNEL_ID.trim(),
};
