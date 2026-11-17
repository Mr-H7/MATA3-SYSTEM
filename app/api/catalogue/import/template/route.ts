import { NextResponse } from "next/server";
import { requireOwner } from "@/lib/auth";
import { buildImportTemplate } from "@/lib/catalogue-import";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await requireOwner();
  } catch {
    return NextResponse.json({ error: "You do not have permission to perform this action" }, { status: 403 });
  }
  const buffer = buildImportTemplate();
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": 'attachment; filename="mata3-catalogue-import-template.xlsx"',
      "Cache-Control": "no-store",
    },
  });
}
