import Link from "next/link";
import CategoryForm from "../category-form";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export default async function NewCategory() {
  const [departments, categories] = await Promise.all([
    prisma.department.findMany({ orderBy: { name: "asc" } }),
    prisma.category.findMany({ where: { archived: false }, select: { id: true, name: true, departmentId: true, parentId: true } }),
  ]);
  return (
    <main className="p-8 max-w-2xl">
      <Link className="gold" href="/categories">
        ← Categories
      </Link>
      <h1 className="text-3xl font-bold my-5">New Category</h1>
      <CategoryForm departments={departments} categories={categories} />
    </main>
  );
}
