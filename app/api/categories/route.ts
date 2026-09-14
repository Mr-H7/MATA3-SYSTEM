import { NextResponse } from "next/server";
import { canManageGlobalData, requireOwner, requireUser } from "@/lib/auth";
import { validateCategoryParent } from "@/lib/category-validation";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const user = await requireUser();
  if (user.role !== "OWNER") return NextResponse.json({ error: "You do not have permission to perform this action" }, { status: 403 });
  return NextResponse.json(await prisma.category.findMany({ include: { department: true, parent: true }, orderBy: { name: "asc" } }));
}

export async function POST(request: Request) {
  try {
    const user = await requireOwner();
    if (!canManageGlobalData(user.role)) return NextResponse.json({ error: "Only OWNER or ADMIN can manage categories" }, { status: 403 });
    const body = await request.json();
    if (!body.name?.trim() || !body.departmentId) return NextResponse.json({ error: "Name and department are required" }, { status: 400 });
    const duplicate = await prisma.category.findFirst({
      where: { departmentId: body.departmentId, name: { equals: body.name.trim(), mode: "insensitive" } },
    });
    if (duplicate) return NextResponse.json({ error: "A category with this name already exists in the department" }, { status: 409 });
    const parentError = await validateCategoryParent({ departmentId: body.departmentId, parentId: body.parentId || null });
    if (parentError) return NextResponse.json({ error: parentError }, { status: 400 });
    return NextResponse.json(
      await prisma.category.create({ data: { name: body.name.trim(), departmentId: body.departmentId, parentId: body.parentId || null } }),
      { status: 201 },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Create failed";
    return NextResponse.json({ error: message === "FORBIDDEN" ? "You do not have permission to perform this action" : message }, { status: message === "FORBIDDEN" ? 403 : 400 });
  }
}
