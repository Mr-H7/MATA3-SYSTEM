import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { Prisma, PrismaClient } from "@prisma/client";
import { removeWebMedia, storeWebMedia } from "./web-media-storage";

const imageTypes: Record<string, { ext: "jpg" | "png" | "webp"; max: number; matches: (bytes: Uint8Array) => boolean }> = {
  "image/jpeg": { ext: "jpg", max: 5_000_000, matches: bytes => bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff },
  "image/png": { ext: "png", max: 5_000_000, matches: bytes => [0x89, 0x50, 0x4e, 0x47].every((value, index) => bytes[index] === value) },
  "image/webp": { ext: "webp", max: 5_000_000, matches: bytes => new TextDecoder().decode(bytes.slice(0, 4)) === "RIFF" && new TextDecoder().decode(bytes.slice(8, 12)) === "WEBP" },
};
const excluded = /chamois|nb[\s-]*574/i;

export type ApprovedMediaManifest = {
  version: 1;
  market: "EGYPT" | "MOROCCO";
  items: ApprovedMediaItem[];
};
type ApprovedMediaItem = {
  sku: string;
  color: string;
  images: { file: string; position: 1 | 2 | 3; cover: boolean; alt: string }[];
};
export type MediaImportReport = {
  dryRun: boolean;
  accepted: { sku: string; color: string; position: number; action: "create" | "skip" }[];
  rejected: { sku: string; color: string; position?: number; reason: string }[];
  unmatched: { sku: string; color: string; reason: string }[];
};

function emptyReport(dryRun: boolean): MediaImportReport {
  return { dryRun, accepted: [], rejected: [], unmatched: [] };
}
function insideRoot(root: string, file: string) {
  const resolved = path.resolve(root, file);
  const relative = path.relative(root, resolved);
  return relative && !relative.startsWith("..") && !path.isAbsolute(relative) ? resolved : null;
}
function detectType(bytes: Uint8Array) {
  return Object.entries(imageTypes).find(([, spec]) => bytes.length <= spec.max && spec.matches(bytes))?.[0] ?? null;
}
function manifestItem(value: unknown): ApprovedMediaItem | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (typeof row.sku !== "string" || typeof row.color !== "string" || !Array.isArray(row.images)) return null;
  const images: ApprovedMediaItem["images"] = [];
  for (const image of row.images) {
    if (!image || typeof image !== "object" || Array.isArray(image)) return null;
    const item = image as Record<string, unknown>;
    if (typeof item.file !== "string" || (item.position !== 1 && item.position !== 2 && item.position !== 3) || typeof item.cover !== "boolean" || typeof item.alt !== "string") return null;
    images.push({ file: item.file, position: item.position, cover: item.cover, alt: item.alt });
  }
  return { sku: row.sku.trim(), color: row.color.trim(), images };
}
export function parseApprovedMediaManifest(value: unknown): ApprovedMediaManifest | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (row.version !== 1 || (row.market !== "EGYPT" && row.market !== "MOROCCO") || !Array.isArray(row.items)) return null;
  const items = row.items.map(manifestItem);
  if (items.some(item => !item)) return null;
  return { version: 1, market: row.market, items: items as ApprovedMediaItem[] };
}

export async function importApprovedMedia(db: PrismaClient, root: string, manifest: ApprovedMediaManifest, dryRun: boolean): Promise<MediaImportReport> {
  const report = emptyReport(dryRun);
  const absoluteRoot = path.resolve(root);
  for (const item of manifest.items) {
    if (!item.sku || !item.color) { report.rejected.push({ sku: item.sku, color: item.color, reason: "SKU and color are required" }); continue; }
    if (excluded.test(item.sku) || excluded.test(item.color)) { report.rejected.push({ sku: item.sku, color: item.color, reason: "Excluded from the approved launch set" }); continue; }
    const positions = new Set(item.images.map(image => image.position));
    if (item.images.length !== 3 || positions.size !== 3 || item.images.filter(image => image.cover).length !== 1) {
      report.rejected.push({ sku: item.sku, color: item.color, reason: "Each color requires image positions 1, 2 and 3 with exactly one cover" });
      continue;
    }
    const variants = await db.productVariant.findMany({
      where: { color: item.color, OR: [{ sku: item.sku }, { product: { sku: item.sku } }] },
      include: { product: true },
    });
    const matches = variants.filter(variant => !excluded.test(variant.product.sku) && !excluded.test(variant.product.nameEn) && !excluded.test(variant.sku));
    if (variants.length !== matches.length) { report.rejected.push({ sku: item.sku, color: item.color, reason: "Excluded from the approved launch set" }); continue; }
    if (!matches.length) { report.unmatched.push({ sku: item.sku, color: item.color, reason: "No existing variant matches this SKU and color" }); continue; }
    if (matches.length !== 1) { report.rejected.push({ sku: item.sku, color: item.color, reason: "SKU and color match more than one variant" }); continue; }
    const variant = matches[0];
    const listing = await db.marketListing.findFirst({ where: { variantId: variant.id, market: { code: manifest.market } }, select: { id: true } });
    if (!listing) { report.unmatched.push({ sku: item.sku, color: item.color, reason: "Variant has no listing in the manifest market" }); continue; }
    let itemRejected = false;
    const prepared: { position: number; cover: boolean; alt: string; bytes: Uint8Array; type: string; hash: string }[] = [];
    for (const image of item.images) {
      if (!image.alt.trim() || image.alt.length > 300) { report.rejected.push({ sku: item.sku, color: item.color, position: image.position, reason: "Alt text is required and must be 300 characters or fewer" }); itemRejected = true; break; }
      const filePath = insideRoot(absoluteRoot, image.file);
      if (!filePath) { report.rejected.push({ sku: item.sku, color: item.color, position: image.position, reason: "Image path is outside the approved media folder" }); itemRejected = true; break; }
      const info = await stat(filePath).catch(() => null);
      if (!info?.isFile()) { report.rejected.push({ sku: item.sku, color: item.color, position: image.position, reason: "Image file was not found" }); itemRejected = true; break; }
      const bytes = new Uint8Array(await readFile(filePath));
      const type = detectType(bytes);
      if (!type) { report.rejected.push({ sku: item.sku, color: item.color, position: image.position, reason: "Image must be a JPEG, PNG or WebP file of 5 MB or less" }); itemRejected = true; break; }
      prepared.push({ position: image.position, cover: image.cover, alt: image.alt.trim(), bytes, type, hash: createHash("sha256").update(bytes).digest("hex") });
    }
    if (itemRejected) continue;
    for (const image of prepared) {
      const importKey = `v1:${variant.id}:${image.position}:${image.hash}`;
      const existing = await db.webProductMedia.findMany({ where: { variantId: variant.id, importKey: { startsWith: `v1:${variant.id}:${image.position}:` } }, select: { importKey: true } });
      if (existing.some(row => row.importKey === importKey)) { report.accepted.push({ sku: item.sku, color: item.color, position: image.position, action: "skip" }); continue; }
      if (existing.length) { report.rejected.push({ sku: item.sku, color: item.color, position: image.position, reason: "A different image is already imported at this position" }); continue; }
      if (dryRun) { report.accepted.push({ sku: item.sku, color: item.color, position: image.position, action: "create" }); continue; }
      const file = new File([Buffer.from(image.bytes)], `${image.position}.${imageTypes[image.type].ext}`, { type: image.type });
      const stored = await storeWebMedia(file);
      try {
        await db.webProductMedia.create({ data: {
          ...stored, altText: image.alt, isCover: image.cover, sortOrder: image.position, publicationStatus: "DRAFT", importKey, variantId: variant.id,
        } });
        report.accepted.push({ sku: item.sku, color: item.color, position: image.position, action: "create" });
      } catch (error) {
        await removeWebMedia(stored.storageKey, stored.url);
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
          report.accepted.push({ sku: item.sku, color: item.color, position: image.position, action: "skip" });
        } else throw error;
      }
    }
  }
  return report;
}
