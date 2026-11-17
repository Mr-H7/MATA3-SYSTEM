import { randomUUID } from "node:crypto";
import { InventoryType, Prisma, type PrismaClient } from "@prisma/client";
import { normalizeSupplierName } from "./cells";
import { slugify } from "../slug";
import type { CatalogueSnapshot, Cell, ImportApplyResult, ImportMode, ParsedImportRow } from "./types";

function value<T>(cell: Cell<T>, fallback: T): T {
  if (!cell.present) return fallback;
  if (cell.clear) return fallback;
  return cell.value;
}

function optional<T>(cell: Cell<T>, fallback: T | null): T | null {
  if (!cell.present) return fallback;
  if (cell.clear) return null;
  return cell.value;
}

export async function applyImport(
  prisma: PrismaClient,
  mode: ImportMode,
  rows: ParsedImportRow[],
  snapshot: CatalogueSnapshot,
  userId: string,
) {
  const runId = randomUUID();
  return prisma.$transaction(async (tx) => {
    const supplierIds = new Map<string, string>();
    for (const supplier of snapshot.suppliers) supplierIds.set(normalizeSupplierName(supplier.name), supplier.id);
    const createdSupplierNames = new Set<string>();
    for (const row of rows.filter((item) => !item.incomplete)) {
      if (!row.supplierName.present || row.supplierName.clear || !row.supplierName.value) continue;
      const key = normalizeSupplierName(row.supplierName.value);
      if (supplierIds.has(key)) continue;
      const created = await tx.supplier.create({ data: { name: row.supplierName.value.trim() } });
      supplierIds.set(key, created.id);
      createdSupplierNames.add(key);
    }

    const productsBySku = new Map(snapshot.products.map((product) => [product.sku, product]));
    const grouped = new Map<string, ParsedImportRow[]>();
    for (const row of rows) {
      if (!grouped.has(row.productSku)) grouped.set(row.productSku, []);
      grouped.get(row.productSku)!.push(row);
    }

    let createdProducts = 0, updatedProducts = 0, unchangedProducts = 0;
    let createdVariants = 0, createdListings = 0, updatedListings = 0, skippedIncomplete = 0, protectedSkips = 0;

    for (const [sku, group] of grouped) {
      const complete = group.filter((row) => !row.incomplete);
      skippedIncomplete += group.length - complete.length;
      if (!complete.length) continue;
      const existing = productsBySku.get(sku);
      if (mode === "CREATE" && existing) throw new Error(`CREATE collision for ${sku}`);
      const first = complete[0];
      const departmentName = optional(first.departmentName, null);
      const categoryName = optional(first.categoryName, null);
      const departmentId = departmentName
        ? snapshot.departments.find((item) => item.name.trim().toLowerCase() === departmentName.trim().toLowerCase())?.id ?? null
        : first.departmentName.present && first.departmentName.clear
          ? null
          : existing?.departmentId ?? null;
      const categoryId = categoryName
        ? snapshot.categories.find((item) => item.name.trim().toLowerCase() === categoryName.trim().toLowerCase() && (!departmentId || item.departmentId === departmentId))?.id ?? null
        : first.categoryName.present && first.categoryName.clear
          ? null
          : existing?.categoryId ?? null;
      const productData = {
        sku,
        nameEn: value(first.nameEn, existing?.nameEn ?? ""),
        nameAr: value(first.nameAr, existing?.nameAr ?? ""),
        brand: optional(first.brand, existing?.brand ?? null),
        model: optional(first.model, existing?.model ?? null),
        gender: value(first.gender, existing?.gender ?? "NA"),
        status: value(first.productStatus, existing?.status ?? "ACTIVE"),
        publicSlug: first.publicSlug.present
          ? first.publicSlug.clear
            ? null
            : slugify(first.publicSlug.value ?? "") || null
          : existing?.publicSlug ?? null,
        internalNotes: optional(first.internalNotes, existing?.internalNotes ?? null),
        departmentId,
        categoryId,
      };
      const productChanged = existing
        ? existing.nameEn !== productData.nameEn
          || existing.nameAr !== productData.nameAr
          || existing.brand !== productData.brand
          || existing.model !== productData.model
          || existing.gender !== productData.gender
          || existing.status !== productData.status
          || existing.publicSlug !== productData.publicSlug
          || existing.internalNotes !== productData.internalNotes
          || existing.departmentId !== productData.departmentId
          || existing.categoryId !== productData.categoryId
        : true;
      const product = existing
        ? productChanged
          ? await tx.product.update({ where: { id: existing.id }, data: productData })
          : existing
        : await tx.product.create({ data: productData });
      if (!existing) createdProducts += 1;
      else if (
        productChanged
      ) updatedProducts += 1;
      else unchangedProducts += 1;

      const variantIds = new Map(existing?.variants.map((variant) => [variant.sku, variant.id]) ?? []);
      for (const row of complete) {
        if (variantIds.has(row.variantSku)) {
          const current = existing?.variants.find((variant) => variant.sku === row.variantSku);
          await tx.productVariant.update({
            where: { id: variantIds.get(row.variantSku)! },
            data: {
              color: optional(row.color, current?.color ?? null),
              size: optional(row.size, current?.size ?? null),
              material: optional(row.material, current?.material ?? null),
            },
          });
          continue;
        }
        const created = await tx.productVariant.create({
          data: {
            productId: product.id,
            sku: row.variantSku,
            color: optional(row.color, null),
            size: optional(row.size, null),
            material: optional(row.material, null),
          },
        });
        variantIds.set(row.variantSku, created.id);
        createdVariants += 1;
      }

      for (const row of complete) {
        if (!row.supplierName.present || row.supplierName.clear || !row.supplierName.value) continue;
        const supplierId = supplierIds.get(normalizeSupplierName(row.supplierName.value));
        if (!supplierId) continue;
        await tx.productSupplier.upsert({
          where: { productId_supplierId: { productId: product.id, supplierId } },
          update: {},
          create: { productId: product.id, supplierId },
        });
      }

      for (const row of complete) {
        const market = snapshot.markets.find((item) => item.code === row.marketCode);
        if (!market) throw new Error(`Missing market ${row.marketCode}`);
        const variantId = variantIds.get(row.variantSku);
        if (!variantId) throw new Error(`Missing variant ${row.variantSku}`);
        const existingListing = existing?.listings.find((listing) => listing.marketId === market.id && listing.variantId === (existing.variants.find((variant) => variant.sku === row.variantSku)?.id ?? null));
        if (mode === "CREATE" && existingListing) throw new Error(`CREATE listing collision ${sku} ${row.marketCode}`);
        const supplierId = optional(row.supplierName, existingListing ? snapshot.suppliers.find((item) => item.id === existingListing.supplierId)?.name ?? null : null);
        const resolvedSupplierId = supplierId ? supplierIds.get(normalizeSupplierName(supplierId)) ?? null : row.supplierName.present ? null : existingListing?.supplierId ?? null;
        const sourceCode = optional(row.inventorySourceMarketCode, existingListing ? snapshot.markets.find((item) => item.id === existingListing.inventorySourceMarketId)?.code ?? null : null);
        const sourceMarket = sourceCode
          ? snapshot.markets.find((item) => item.code === sourceCode.toUpperCase())?.id ?? null
          : row.inventorySourceMarketCode.present
            ? null
            : existingListing?.inventorySourceMarketId ?? null;
        if (!row.cost.present || row.cost.clear || !row.price.present || row.price.clear) {
          throw new Error(`Refusing to write ${sku} ${row.marketCode} without cost and price`);
        }
        const onDemand = value(row.inventoryType, existingListing?.inventoryType ?? InventoryType.PHYSICAL_STOCK) === InventoryType.ON_DEMAND;
        if (existingListing?.webPublicationStatus === "PUBLISHED") {
          protectedSkips += 1;
          continue;
        }
        if (existingListing && row.price.present && !row.price.clear && Number(existingListing.price) !== row.price.value) {
          protectedSkips += 1;
          continue;
        }
        const listingData = {
          supplierId: resolvedSupplierId,
          cost: new Prisma.Decimal(value(row.cost, existingListing ? Number(existingListing.cost) : 0)),
          price: new Prisma.Decimal(value(row.price, existingListing ? Number(existingListing.price) : 0)),
          available: value(row.available, existingListing?.available ?? true),
          inventoryType: value(row.inventoryType, existingListing?.inventoryType ?? InventoryType.PHYSICAL_STOCK),
          webPublicationStatus: "DRAFT" as const,
          inventorySourceMarketId: sourceMarket,
        };
        if (existingListing) {
          const changed = Number(existingListing.cost) !== Number(listingData.cost)
            || existingListing.available !== listingData.available
            || existingListing.inventoryType !== listingData.inventoryType
            || existingListing.supplierId !== listingData.supplierId
            || existingListing.inventorySourceMarketId !== listingData.inventorySourceMarketId;
          if (changed && existingListing.webPublicationStatus === "DRAFT") {
            await tx.marketListing.update({ where: { id: existingListing.id }, data: listingData });
            updatedListings += 1;
          }
        } else {
          const created = await tx.marketListing.create({
            data: {
              publicOfferId: randomUUID(),
              productId: product.id,
              variantId,
              marketId: market.id,
              ...listingData,
            },
          });
          await tx.inventory.create({
            data: {
              listingId: created.id,
              marketId: market.id,
              currentStock: onDemand || !row.stock.present || row.stock.clear ? 0 : row.stock.value,
              reservedStock: 0,
            },
          });
          createdListings += 1;
        }
      }
    }

    const result: ImportApplyResult = {
      runId,
      mode,
      createdProducts,
      updatedProducts,
      unchangedProducts,
      createdVariants,
      createdListings,
      updatedListings,
      createdSuppliers: createdSupplierNames.size,
      skippedIncomplete,
      protectedSkips,
    };
    await tx.auditLog.create({
      data: {
        userId,
        action: "CATALOGUE_BULK_IMPORT",
        entity: "CatalogueImport",
        entityId: runId,
        metadata: { mode, createdProducts, updatedProducts, createdListings, updatedListings, createdSuppliers: result.createdSuppliers, skippedIncomplete },
      },
    });
    return result;
  }, { timeout: 60000 });
}
