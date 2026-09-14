import { NextResponse } from "next/server";
import { requireOwner } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET() {
  try {
    await requireOwner();
    return NextResponse.json(await prisma.department.findMany({ orderBy: { name: "asc" } }));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load departments";
    return NextResponse.json(
      { error: message === "FORBIDDEN" || message === "UNAUTHENTICATED" ? "You do not have permission to perform this action" : message },
      { status: message === "FORBIDDEN" || message === "UNAUTHENTICATED" ? 403 : 400 },
    );
  }
}
