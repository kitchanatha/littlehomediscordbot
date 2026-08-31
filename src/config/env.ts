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
};
