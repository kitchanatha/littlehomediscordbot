import { sheets_v4 } from "googleapis";

export function hexToRgb(hex: string): sheets_v4.Schema$Color | null {
  if (!hex) return null;
  
  // Remove # if present
  const cleanHex = hex.startsWith("#") ? hex.slice(1) : hex;
  
  if (cleanHex.length !== 6) return null;
  
  const r = parseInt(cleanHex.slice(0, 2), 16) / 255;
  const g = parseInt(cleanHex.slice(2, 4), 16) / 255;
  const b = parseInt(cleanHex.slice(4, 6), 16) / 255;
  
  return {
    red: r,
    green: g,
    blue: b
  };
}
