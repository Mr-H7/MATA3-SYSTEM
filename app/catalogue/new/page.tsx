import Link from "next/link";
import ProductForm from "../product-form";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export default async function NewProduct() {
  const [departments, categories, suppliers] = await Promise.all([
    prisma.department.findMany({ orderBy: { name: "asc" } }),
    prisma.category.findMany({ where: { archived: false }, orderBy: { name: "asc" } }),
    prisma.supplier.findMany({ include: { market: true }, orderBy: { name: "asc" } }),
  ]);
  return (
    <main className="p-5 md:p-8 max-w-5xl">
      <Link className="gold" href="/catalogue">
        ← Catalogue
      </Link>
      <h1 className="text-3xl font-bold my-5">Add Product</h1>
      <ProductForm departments={departments} categories={categories} suppliers={suppliers.map((supplier) => ({ id: supplier.id, name: supplier.name, marketCode: supplier.market?.code || null }))} />
    </main>
  );
}
