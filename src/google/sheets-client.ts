import { google, sheets_v4 } from "googleapis";
import { env } from "../config/env.js";

const auth = new google.auth.JWT({
  email: env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
  key: env.GOOGLE_PRIVATE_KEY,
  scopes: ["https://www.googleapis.com/auth/spreadsheets"],
});

export const sheetsClient: sheets_v4.Sheets = google.sheets({ version: "v4", auth });
