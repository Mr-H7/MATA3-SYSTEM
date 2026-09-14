import { prisma } from "./prisma";

export async function validateCategoryParent(input: { categoryId?: string; parentId: string | null; departmentId: string }) {
  if (!input.parentId) return null;
  if (input.categoryId && input.parentId === input.categoryId) return "A category cannot be its own parent";
  const parent = await prisma.category.findUnique({ where: { id: input.parentId } });
  if (!parent) return "Parent category not found";
  if (parent.departmentId !== input.departmentId) return "Parent category must belong to the same department";
  if (parent.parentId) return "Only one hierarchy level is supported; choose a top-level category as parent";
  if (input.categoryId) {
    let cursor: string | null = input.parentId;
    const visited = new Set<string>();
    while (cursor) {
      if (visited.has(cursor)) return "Circular category hierarchy is not allowed";
      if (cursor === input.categoryId) return "Circular category hierarchy is not allowed";
      visited.add(cursor);
      const row: { parentId: string | null } | null = await prisma.category.findUnique({
        where: { id: cursor },
        select: { parentId: true },
      });
      if (!row?.parentId) break;
      cursor = row.parentId;
    }
    const directChild = await prisma.category.findFirst({ where: { parentId: input.categoryId } });
    if (directChild && input.parentId) return "This category already has subcategories and cannot become a child";
  }
  return null;
}
