import { createHmac, timingSafeEqual } from "node:crypto";
import type { ImportMode } from "./types";

function secret() {
  return process.env.SESSION_SECRET || (process.env.NODE_ENV === "production" ? "" : "mata3-development-session-secret-change-me");
}

export function signImportPreview(input: { mode: ImportMode; fileSha256: string; userId: string; canConfirm: boolean }) {
  const payload = `${input.userId}.${input.mode}.${input.fileSha256}.${input.canConfirm ? "1" : "0"}`;
  return `${payload}.${createHmac("sha256", secret()).update(payload).digest("hex")}`;
}

export function verifyImportPreview(token: string, expected: { mode: ImportMode; fileSha256: string; userId: string }) {
  const separator = token.lastIndexOf(".");
  if (separator < 1) return false;
  const payload = token.slice(0, separator);
  const supplied = token.slice(separator + 1);
  const expectedPayload = `${expected.userId}.${expected.mode}.${expected.fileSha256}`;
  if (!payload.startsWith(expectedPayload)) return false;
  const signature = createHmac("sha256", secret()).update(payload).digest("hex");
  if (supplied.length !== signature.length) return false;
  return timingSafeEqual(Buffer.from(supplied), Buffer.from(signature)) && payload.endsWith(".1");
}
