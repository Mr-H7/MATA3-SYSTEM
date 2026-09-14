import { NextResponse } from "next/server";
import { canManageGlobalData, requireOwner, requireUser } from "@/lib/auth";
import { validateCategoryParent } from "@/lib/category-validation";
import { prisma } from "@/lib/prisma";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    if (user.role !== "OWNER") return NextResponse.json({ error: "You do not have permission to perform this action" }, { status: 403 });
    const { id } = await params;
    return NextResponse.json(await prisma.category.findUniqueOrThrow({ where: { id }, include: { department: true, parent: true } }));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Not found" }, { status: 404 });
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireOwner();
    if (!canManageGlobalData(user.role)) return NextResponse.json({ error: "Only OWNER or ADMIN can manage categories" }, { status: 403 });
    const { id } = await params;
    const body = await request.json();
    if (body.archived === true) return NextResponse.json(await prisma.category.update({ where: { id }, data: { archived: true } }));
    if (!body.name?.trim() || !body.departmentId) return NextResponse.json({ error: "Name and department are required" }, { status: 400 });
    const duplicate = await prisma.category.findFirst({
      where: {
        id: { not: id },
        departmentId: body.departmentId,
        name: { equals: body.name.trim(), mode: "insensitive" },
      },
    });
    if (duplicate) return NextResponse.json({ error: "A category with this name already exists in the department" }, { status: 409 });
    const parentError = await validateCategoryParent({ categoryId: id, departmentId: body.departmentId, parentId: body.parentId || null });
    if (parentError) return NextResponse.json({ error: parentError }, { status: 400 });
    return NextResponse.json(
      await prisma.category.update({
        where: { id },
        data: { name: body.name.trim(), departmentId: body.departmentId, parentId: body.parentId || null, archived: Boolean(body.archived) },
      }),
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Update failed";
    return NextResponse.json({ error: message === "FORBIDDEN" ? "You do not have permission to perform this action" : message }, { status: message === "FORBIDDEN" ? 403 : 400 });
  }
}
