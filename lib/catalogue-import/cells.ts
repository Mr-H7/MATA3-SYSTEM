import { Gender, InventoryType, ProductStatus, WebPublicationStatus } from "@prisma/client";
import { CLEAR_TOKEN, SKU_PATTERN, type Cell } from "./types";

export function rawCell(value: unknown) {
  if (value == null) return "";
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return String(value).replace(/^\uFEFF/, "").trim();
}

export function presentCell(raw: string): Cell<string> {
  if (!raw) return { present: false };
  if (raw === CLEAR_TOKEN) return { present: true, clear: true };
  return { present: true, clear: false, value: raw };
}

export function cellValue<T>(cell: Cell<T>, fallback: T): T {
  if (!cell.present || cell.clear) return fallback;
  return cell.value;
}

export function normalizeSku(value: string) {
  return value.trim();
}

export function normalizeSupplierName(value: string) {
  return value.normalize("NFC").replace(/\s+/g, " ").trim().toLowerCase();
}

export function parseSku(value: string) {
  const sku = normalizeSku(value);
  if (!sku) return { ok: false as const, message: "SKU is required" };
  if (!SKU_PATTERN.test(sku)) return { ok: false as const, message: "SKU must be 1-63 characters of letters, numbers, '.', '_' or '-'" };
  return { ok: true as const, value: sku };
}

export function parseEnum<T extends string>(value: string, allowed: readonly T[], label: string) {
  const normalized = value.trim().toUpperCase().replace(/\s+/g, "_");
  if (allowed.includes(normalized as T)) return { ok: true as const, value: normalized as T };
  return { ok: false as const, message: `${label} must be one of ${allowed.join(", ")}` };
}

export function parseMoney(value: string, label: string) {
  const cleaned = value.replace(/,/g, "").trim();
  if (!cleaned) return { ok: false as const, message: `${label} is required` };
  if (!/^-?\d+(\.\d{1,2})?$/.test(cleaned)) return { ok: false as const, message: `${label} must be a decimal with up to 2 places` };
  const amount = Number(cleaned);
  if (!Number.isFinite(amount)) return { ok: false as const, message: `${label} is not a valid number` };
  if (amount < 0) return { ok: false as const, message: `${label} cannot be negative` };
  return { ok: true as const, value: Number(amount.toFixed(2)) };
}

export function parseStock(value: string) {
  const cleaned = value.replace(/,/g, "").trim();
  if (!cleaned) return { ok: false as const, message: "Stock is required" };
  if (!/^-?\d+$/.test(cleaned)) return { ok: false as const, message: "Stock must be a whole number" };
  const stock = Number(cleaned);
  if (!Number.isInteger(stock) || stock < 0) return { ok: false as const, message: "Stock cannot be negative" };
  return { ok: true as const, value: stock };
}

export function parseAvailability(value: string) {
  const normalized = value.trim().toLowerCase();
  if (["yes", "true", "1", "available"].includes(normalized)) return { ok: true as const, value: true };
  if (["no", "false", "0", "unavailable"].includes(normalized)) return { ok: true as const, value: false };
  return { ok: false as const, message: "Availability must be Yes or No" };
}

export function parseFilename(value: string) {
  if (!/^[^\\/:*?"<>|]+\.(png|jpe?g|webp|gif|avif)$/i.test(value)) {
    return { ok: false as const, message: "Filename must be a single image file name, not a path" };
  }
  return { ok: true as const, value };
}

export const GENDERS = ["MEN", "WOMEN", "KIDS", "UNISEX", "NA"] as const satisfies readonly Gender[];
export const INVENTORY_TYPES = ["PHYSICAL_STOCK", "ON_DEMAND", "SUPPLIER_STOCK", "PREORDER"] as const satisfies readonly InventoryType[];
export const WEB_STATUSES = ["DRAFT", "PUBLISHED", "HIDDEN"] as const satisfies readonly WebPublicationStatus[];
export const PRODUCT_STATUSES = ["ACTIVE", "DRAFT", "HIDDEN", "OUT_OF_STOCK", "COMING_SOON", "ARCHIVED"] as const satisfies readonly ProductStatus[];
export const PROVENANCES = ["ORIGINAL_VERIFIED", "THIRD_PARTY_COMPATIBLE", "HIGH_COPY", "UNVERIFIED", "NOT_APPLICABLE"] as const;
