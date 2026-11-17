import type { PrismaClient } from "@prisma/client";
import { applyImport } from "./apply";
import { parseRows, parseWorkbook } from "./parse";
import { buildPreview } from "./preview";
import { loadCatalogueSnapshot } from "./snapshot";
import type { ImportMode } from "./types";

export { buildImportTemplate, issuesCsv } from "./template";
export { signImportPreview, verifyImportPreview } from "./token";
export { TEMPLATE_COLUMNS } from "./columns";
export { CLEAR_TOKEN, MAX_IMPORT_BYTES, MAX_IMPORT_ROWS } from "./types";
export type { ImportApplyResult, ImportMode, ImportPreview } from "./types";

export async function previewCatalogueImport(prisma: PrismaClient, mode: ImportMode, buffer: Buffer, filename: string) {
  const parsed = parseWorkbook(buffer, filename);
  const { rows, issues } = parseRows(parsed.rows);
  const snapshot = await loadCatalogueSnapshot(prisma);
  return buildPreview(mode, parsed.fileSha256, rows, issues, snapshot);
}

export async function confirmCatalogueImport(
  prisma: PrismaClient,
  mode: ImportMode,
  buffer: Buffer,
  filename: string,
  userId: string,
) {
  const parsed = parseWorkbook(buffer, filename);
  const { rows, issues } = parseRows(parsed.rows);
  const snapshot = await loadCatalogueSnapshot(prisma);
  const preview = buildPreview(mode, parsed.fileSha256, rows, issues, snapshot);
  if (!preview.canConfirm) throw new Error("Import is blocked by validation errors or has no changes");
  const result = await applyImport(prisma, mode, rows, snapshot, userId);
  return { preview, result };
}
