import { NextResponse } from "next/server";
import { requireOwner } from "@/lib/auth";
import { confirmCatalogueImport, previewCatalogueImport, verifyImportPreview } from "@/lib/catalogue-import";
import { prisma } from "@/lib/prisma";
import type { ImportMode } from "@/lib/catalogue-import";

export const dynamic = "force-dynamic";

function modeOf(value: FormDataEntryValue | null): ImportMode | null {
  return value === "CREATE" || value === "MERGE" ? value : null;
}

export async function POST(request: Request) {
  try {
    const user = await requireOwner();
    const form = await request.formData();
    const mode = modeOf(form.get("mode"));
    const file = form.get("file");
    const token = String(form.get("confirmToken") || "");
    if (!mode) return NextResponse.json({ error: "Mode must be CREATE or MERGE" }, { status: 400 });
    if (!(file instanceof File)) return NextResponse.json({ error: "Re-upload the same file to confirm" }, { status: 400 });
    const buffer = Buffer.from(await file.arrayBuffer());
    const preview = await previewCatalogueImport(prisma, mode, buffer, file.name);
    if (!verifyImportPreview(token, { mode, fileSha256: preview.fileSha256, userId: user.id })) {
      return NextResponse.json({ error: "Confirm token does not match this file, mode, and owner session" }, { status: 400 });
    }
    const applied = await confirmCatalogueImport(prisma, mode, buffer, file.name, user.id);
    return NextResponse.json(applied);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Import failed";
    return NextResponse.json({ error: message === "FORBIDDEN" ? "You do not have permission to perform this action" : message }, { status: message === "FORBIDDEN" ? 403 : 400 });
  }
}
