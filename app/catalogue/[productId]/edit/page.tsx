import Link from "next/link";
import { notFound } from "next/navigation";
import ProductForm from "../../product-form";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export default async function EditProduct({ params }: { params: Promise<{ productId: string }> }) {
  const { productId } = await params;
  const [product, departments, categories, suppliers] = await Promise.all([
    prisma.product.findUnique({
      where: { id: productId },
      include: {
        variants: true,
        images: { orderBy: [{ isPrimary: "desc" }, { sortOrder: "asc" }] },
        listings: { include: { market: true, inventorySourceMarket: true } },
      },
    }),
    prisma.department.findMany({ orderBy: { name: "asc" } }),
    prisma.category.findMany({ where: { archived: false }, orderBy: { name: "asc" } }),
    prisma.supplier.findMany({ include: { market: true }, orderBy: { name: "asc" } }),
  ]);
  if (!product) notFound();
  const initial = {
    id: product.id,
    sku: product.sku,
    nameAr: product.nameAr,
    nameEn: product.nameEn,
    descriptionAr: product.descriptionAr || "",
    descriptionEn: product.descriptionEn || "",
    departmentId: product.departmentId || "",
    categoryId: product.categoryId || "",
    brand: product.brand || "",
    model: product.model || "",
    gender: product.gender,
    status: product.status,
    internalNotes: product.internalNotes || "",
    publicSlug: product.publicSlug || "",
    variants: product.variants.map((variant) => ({
      id: variant.id,
      sku: variant.sku,
      color: variant.color || "",
      size: variant.size || "",
      material: variant.material || "",
      supplierCode: variant.supplierCode || "",
      barcode: variant.barcode || "",
    })),
    listings: product.listings.map((listing) => ({
      id: listing.id,
      marketCode: listing.market.code,
      variantSku: product.variants.find((variant) => variant.id === listing.variantId)?.sku || "",
      supplierId: listing.supplierId || "",
      cost: Number(listing.cost),
      price: Number(listing.price),
      compareAt: listing.compareAt === null ? null : Number(listing.compareAt),
      available: listing.available,
      inventoryType: listing.inventoryType,
      minimumStock: listing.minimumStock,
      notes: listing.notes || "",
      inventorySourceMarketCode: listing.inventorySourceMarket?.code || listing.market.code,
    })),
    images: product.images,
  };
  return (
    <main className="p-5 md:p-8 max-w-5xl">
      <Link className="gold" href={`/catalogue/${productId}`}>
        ← Product
      </Link>
      <h1 className="text-3xl font-bold my-5">Edit Product</h1>
      <ProductForm initial={initial} departments={departments} categories={categories} suppliers={suppliers.map((supplier) => ({ id: supplier.id, name: supplier.name, marketCode: supplier.market?.code || null }))} />
    </main>
  );
}
