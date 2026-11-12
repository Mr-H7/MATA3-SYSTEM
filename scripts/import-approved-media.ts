import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PrismaClient } from "@prisma/client";
import { importApprovedMedia, parseApprovedMediaManifest } from "../lib/approved-media-import";

const args = process.argv.slice(2);
const value = (flag: string) => {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
};
const dryRun = args.includes("--dry-run");
const manifestPath = value("--manifest");
const root = value("--root");
const databaseUrl = process.env.DATABASE_URL || "";
let database: URL;
try { database = new URL(databaseUrl); } catch { throw new Error("DATABASE_URL must be a local database URL"); }
const local = ["localhost", "127.0.0.1"].includes(database.hostname);
if (!local && value("--confirm-database") !== database.pathname.replace(/^\//, "").split("?")[0]) {
  throw new Error("Remote import requires --confirm-database with the exact database name. Production publication is not performed by this tool.");
}
if (!manifestPath || !root) throw new Error("Usage: tsx scripts/import-approved-media.ts --manifest manifest.json --root approved-media [--dry-run] [--confirm-database name]");

const manifest = parseApprovedMediaManifest(JSON.parse(readFileSync(resolve(manifestPath), "utf8")));
if (!manifest) throw new Error("Manifest must be version 1 with market EGYPT or MOROCCO and three positioned images per SKU and color");
const db = new PrismaClient();
const report = await importApprovedMedia(db, resolve(root), manifest, dryRun);
await db.$disconnect();
console.log(JSON.stringify(report, null, 2));
if (report.rejected.length || report.unmatched.length) process.exitCode = 2;
