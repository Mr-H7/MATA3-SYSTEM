import { NextResponse } from "next/server";
import { requireOwner } from "@/lib/auth";
import { issuesCsv, previewCatalogueImport } from "@/lib/catalogue-import";
import { prisma } from "@/lib/prisma";
import type { ImportMode } from "@/lib/catalogue-import";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const user = await requireOwner();
    void user;
    const form = await request.formData();
    const mode = form.get("mode");
    const file = form.get("file");
    if (mode !== "CREATE" && mode !== "MERGE") return NextResponse.json({ error: "Mode must be CREATE or MERGE" }, { status: 400 });
    if (!(file instanceof File)) return NextResponse.json({ error: "A file is required" }, { status: 400 });
    const preview = await previewCatalogueImport(prisma, mode as ImportMode, Buffer.from(await file.arrayBuffer()), file.name);
    return new NextResponse(issuesCsv(preview.issues), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": 'attachment; filename="mata3-import-issues.csv"',
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Report failed";
    return NextResponse.json({ error: message === "FORBIDDEN" ? "You do not have permission to perform this action" : message }, { status: message === "FORBIDDEN" ? 403 : 400 });
  }
}
