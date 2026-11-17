import { NextResponse } from "next/server";
import { requireOwner } from "@/lib/auth";
import { previewCatalogueImport, signImportPreview } from "@/lib/catalogue-import";
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
    if (!mode) return NextResponse.json({ error: "Mode must be CREATE or MERGE" }, { status: 400 });
    if (!(file instanceof File)) return NextResponse.json({ error: "A .csv or .xlsx file is required" }, { status: 400 });
    const buffer = Buffer.from(await file.arrayBuffer());
    const preview = await previewCatalogueImport(prisma, mode, buffer, file.name);
    return NextResponse.json({
      preview,
      confirmToken: preview.canConfirm ? signImportPreview({ mode, fileSha256: preview.fileSha256, userId: user.id, canConfirm: true }) : null,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Preview failed";
    return NextResponse.json({ error: message === "FORBIDDEN" ? "You do not have permission to perform this action" : message }, { status: message === "FORBIDDEN" ? 403 : 400 });
  }
}
