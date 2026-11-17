import { normalizeSupplierName } from "./cells";
import { slugify } from "../slug";
import type {
  CatalogueSnapshot,
  Cell,
  FieldDiff,
  ImportIssue,
  ImportMode,
  ImportPreview,
  ListingPlan,
  ParsedImportRow,
  ProductPlan,
  SupplierPlan,
} from "./types";

function display(value: unknown) {
  if (value == null || value === "") return "[empty]";
  return String(value);
}

function diff(field: string, from: unknown, to: unknown, created = false): FieldDiff {
  const fromText = display(from);
  const toText = display(to);
  return { field, from: fromText, to: toText, status: created ? "create" : fromText === toText ? "unchanged" : "update" };
}

function applyCell<T>(cell: Cell<T>, current: T | null | undefined): { next: T | null | undefined; touched: boolean } {
  if (!cell.present) return { next: current, touched: false };
  if (cell.clear) return { next: null, touched: true };
  return { next: cell.value, touched: true };
}

function resolveName(rows: Array<{ id: string; name: string }>, raw: string) {
  const needle = raw.trim().toLowerCase();
  return rows.filter((row) => row.name.trim().toLowerCase() === needle);
}

function supplierPlans(rows: ParsedImportRow[], snapshot: CatalogueSnapshot, issues: ImportIssue[]): SupplierPlan[] {
  const names = new Map<string, { name: string; rowNumber: number; sku: string; market: string }>();
  for (const row of rows) {
    if (!row.supplierName.present || row.supplierName.clear || !row.supplierName.value) continue;
    const key = normalizeSupplierName(row.supplierName.value);
    if (!names.has(key)) names.set(key, { name: row.supplierName.value.trim(), rowNumber: row.rowNumber, sku: row.productSku, market: row.marketCode });
  }
  const plans: SupplierPlan[] = [];
  for (const [key, info] of names) {
    const matches = snapshot.suppliers.filter((supplier) => normalizeSupplierName(supplier.name) === key);
    if (matches.length > 1) {
      issues.push({ level: "ERROR", rowNumber: info.rowNumber, sku: info.sku, market: info.market, code: "SUPPLIER_AMBIGUOUS", message: `Supplier "${info.name}" matches more than one existing record` });
      plans.push({ name: info.name, action: "ambiguous", existingId: null });
    } else if (matches.length === 1) {
      plans.push({ name: info.name, action: "reuse", existingId: matches[0].id });
    } else {
      plans.push({ name: info.name, action: "create", existingId: null });
    }
  }
  return plans;
}

function expectedCurrency(market: string) {
  return market === "EGYPT" ? "EGP" : "MAD";
}

export function buildPreview(mode: ImportMode, fileSha256: string, rows: ParsedImportRow[], baseIssues: ImportIssue[], snapshot: CatalogueSnapshot): ImportPreview {
  const issues = [...baseIssues];
  const productsBySku = new Map(snapshot.products.map((product) => [product.sku, product]));
  const variantOwners = new Map<string, string>();
  for (const product of snapshot.products) {
    variantOwners.set(product.sku, product.sku);
    for (const variant of product.variants) variantOwners.set(variant.sku, product.sku);
  }
  const grouped = new Map<string, ParsedImportRow[]>();
  const listingKeys = new Map<string, number>();
  for (const row of rows) {
    const listKey = `${row.productSku}|${row.variantSku}|${row.marketCode}`;
    listingKeys.set(listKey, (listingKeys.get(listKey) ?? 0) + 1);
    if (!grouped.has(row.productSku)) grouped.set(row.productSku, []);
    grouped.get(row.productSku)!.push(row);
  }
  for (const [key, count] of listingKeys) {
    if (count < 2) continue;
    const [sku, , market] = key.split("|");
    const sample = rows.find((row) => `${row.productSku}|${row.variantSku}|${row.marketCode}` === key)!;
    issues.push({ level: "ERROR", rowNumber: sample.rowNumber, sku, market, code: "DUPLICATE_ROW", message: "Duplicate product/variant/market row" });
  }

  const suppliers = supplierPlans(rows, snapshot, issues);
  const supplierByName = new Map(suppliers.map((supplier) => [normalizeSupplierName(supplier.name), supplier]));
  const products: ProductPlan[] = [];

  for (const [sku, group] of grouped) {
    const existing = productsBySku.get(sku) ?? null;
    if (mode === "CREATE" && existing) {
      issues.push({ level: "ERROR", rowNumber: group[0].rowNumber, sku, market: group[0].marketCode, code: "SKU_COLLISION", message: "CREATE cannot update an existing SKU; use MERGE" });
    }
    if (mode === "MERGE" && !existing) {
      // MERGE may create new SKUs; treated as create.
    }
    const owner = variantOwners.get(sku);
    if (owner && owner !== sku) {
      issues.push({ level: "ERROR", rowNumber: group[0].rowNumber, sku, market: group[0].marketCode, code: "SKU_COLLISION", message: `SKU belongs to an existing variant of ${owner}` });
    }
    for (const row of group) {
      const fileOwner = variantOwners.get(row.variantSku);
      if (fileOwner && fileOwner !== sku) {
        issues.push({ level: "ERROR", rowNumber: row.rowNumber, sku, market: row.marketCode, code: "VARIANT_COLLISION", message: `Variant SKU ${row.variantSku} already belongs to ${fileOwner}` });
      } else {
        variantOwners.set(row.variantSku, sku);
      }
    }

    const firstComplete = group.find((row) => !row.incomplete) ?? group[0];
    const nameEn = applyCell(firstComplete.nameEn, existing?.nameEn ?? "");
    const nameAr = applyCell(firstComplete.nameAr, existing?.nameAr ?? "");
    if (!existing && (!nameEn.touched || !nameEn.next)) {
      issues.push({ level: "ERROR", rowNumber: firstComplete.rowNumber, sku, market: firstComplete.marketCode, code: "NAME_EN", message: "Name EN is required for new products" });
    }
    const brand = applyCell(firstComplete.brand, existing?.brand ?? null);
    const model = applyCell(firstComplete.model, existing?.model ?? null);
    const gender = applyCell(firstComplete.gender, existing?.gender ?? "NA");
    const publicSlug = applyCell(
      firstComplete.publicSlug.present && !firstComplete.publicSlug.clear
        ? { present: true, clear: false, value: slugify(firstComplete.publicSlug.value ?? "") || null }
        : firstComplete.publicSlug,
      existing?.publicSlug ?? null,
    );
    const internalNotes = applyCell(firstComplete.internalNotes, existing?.internalNotes ?? null);
    const productStatus = applyCell(firstComplete.productStatus, existing?.status ?? "ACTIVE");

    let departmentId = existing?.departmentId ?? null;
    if (firstComplete.departmentName.present) {
      if (firstComplete.departmentName.clear) departmentId = null;
      else {
        const matches = resolveName(snapshot.departments, firstComplete.departmentName.value ?? "");
        if (!matches.length) issues.push({ level: "ERROR", rowNumber: firstComplete.rowNumber, sku, market: firstComplete.marketCode, code: "DEPARTMENT", message: `Unknown department "${firstComplete.departmentName.value}"` });
        else departmentId = matches[0].id;
      }
    }
    let categoryId = existing?.categoryId ?? null;
    if (firstComplete.categoryName.present) {
      if (firstComplete.categoryName.clear) categoryId = null;
      else {
        const categoryLabel = firstComplete.categoryName.value ?? "";
        const matches = snapshot.categories.filter((category) => !category.archived && category.name.trim().toLowerCase() === categoryLabel.trim().toLowerCase() && (!departmentId || category.departmentId === departmentId));
        if (!matches.length) issues.push({ level: "ERROR", rowNumber: firstComplete.rowNumber, sku, market: firstComplete.marketCode, code: "CATEGORY", message: `Unknown category "${categoryLabel}"` });
        else if (matches.length > 1) issues.push({ level: "ERROR", rowNumber: firstComplete.rowNumber, sku, market: firstComplete.marketCode, code: "CATEGORY", message: `Category "${categoryLabel}" is ambiguous` });
        else categoryId = matches[0].id;
      }
    }

    const productDiffs = [
      diff("Name EN", existing?.nameEn, nameEn.next ?? "", !existing),
      diff("Name AR", existing?.nameAr, nameAr.next ?? "", !existing),
      diff("Brand", existing?.brand, brand.next ?? null, !existing),
      diff("Model", existing?.model, model.next ?? null, !existing),
      diff("Gender", existing?.gender, gender.next ?? "NA", !existing),
      diff("Public slug", existing?.publicSlug, publicSlug.next ?? null, !existing),
      diff("Internal notes", existing?.internalNotes, internalNotes.next ?? null, !existing),
      diff("Status", existing?.status, productStatus.next ?? "ACTIVE", !existing),
      diff("Department", snapshot.departments.find((row) => row.id === existing?.departmentId)?.name, snapshot.departments.find((row) => row.id === departmentId)?.name, !existing),
      diff("Category", snapshot.categories.find((row) => row.id === existing?.categoryId)?.name, snapshot.categories.find((row) => row.id === categoryId)?.name, !existing),
    ];
    const productAction = !existing ? "create" : productDiffs.some((item) => item.status === "update") ? "update" : "unchanged";

    const variantMap = new Map<string, ParsedImportRow[]>();
    for (const row of group) {
      if (!variantMap.has(row.variantSku)) variantMap.set(row.variantSku, []);
      variantMap.get(row.variantSku)!.push(row);
    }
    const variants: ProductPlan["variants"] = [];
    for (const [variantSku, variantRows] of variantMap) {
      const existingVariant = existing?.variants.find((variant) => variant.sku === variantSku) ?? null;
      const otherOwner = variantOwners.get(variantSku);
      if (otherOwner && otherOwner !== sku) {
        issues.push({ level: "ERROR", rowNumber: variantRows[0].rowNumber, sku, market: variantRows[0].marketCode, code: "VARIANT_COLLISION", message: `Variant SKU ${variantSku} already belongs to ${otherOwner}` });
      }
      const identities = variantRows.map((row) => JSON.stringify({
        color: applyCell(row.color, existingVariant?.color ?? null).next ?? null,
        size: applyCell(row.size, existingVariant?.size ?? null).next ?? null,
        material: applyCell(row.material, existingVariant?.material ?? null).next ?? null,
      }));
      if (new Set(identities).size > 1) {
        issues.push({ level: "ERROR", rowNumber: variantRows[0].rowNumber, sku, market: variantRows[0].marketCode, code: "VARIANT_CONFLICT", message: `Variant ${variantSku} has conflicting color/size/material values` });
      }
      const sample = variantRows[0];
      const color = applyCell(sample.color, existingVariant?.color ?? null);
      const size = applyCell(sample.size, existingVariant?.size ?? null);
      const material = applyCell(sample.material, existingVariant?.material ?? null);
      const variantDiffs = [
        diff("Color", existingVariant?.color, color.next ?? null, !existingVariant),
        diff("Size", existingVariant?.size, size.next ?? null, !existingVariant),
        diff("Material", existingVariant?.material, material.next ?? null, !existingVariant),
      ];
      if (sample.color.present && !sample.color.clear && sample.color.value && (/[/+]/.test(sample.color.value) || ["COD", "BLUE MARIE"].includes(sample.color.value))) {
        issues.push({ level: "WARNING", rowNumber: sample.rowNumber, sku, market: sample.marketCode, code: "VARIANT_TOKEN", message: `Ambiguous variant token preserved exactly: ${sample.color.value}` });
      }
      variants.push({
        action: !existingVariant ? "create" : variantDiffs.some((item) => item.status === "update") ? "update" : "unchanged",
        variantSku,
        diffs: variantDiffs,
      });
    }

    const listings: ListingPlan[] = [];
    for (const row of group) {
      const market = snapshot.markets.find((item) => item.code === row.marketCode);
      if (!market) {
        issues.push({ level: "ERROR", rowNumber: row.rowNumber, sku, market: row.marketCode, code: "MARKET", message: `Unknown market ${row.marketCode}` });
        continue;
      }
      const currency = row.currency.present && !row.currency.clear ? row.currency.value : market.currency;
      if (currency !== market.currency) {
        issues.push({ level: "ERROR", rowNumber: row.rowNumber, sku, market: row.marketCode, code: "CURRENCY", message: `Currency ${currency} does not match ${market.code} (${market.currency})` });
      } else if (!row.currency.present && !row.incomplete) {
        issues.push({ level: "WARNING", rowNumber: row.rowNumber, sku, market: row.marketCode, code: "CURRENCY_DEFAULT", message: `Currency defaulted to ${market.currency}` });
      }
      if (currency !== expectedCurrency(row.marketCode)) {
        issues.push({ level: "ERROR", rowNumber: row.rowNumber, sku, market: row.marketCode, code: "CURRENCY", message: "Currency does not match the independent market" });
      }
      if (row.inventorySourceMarketCode.present && !row.inventorySourceMarketCode.clear) {
        const sourceCode = (row.inventorySourceMarketCode.value ?? "").toUpperCase();
        const source = snapshot.markets.find((item) => item.code === sourceCode);
        if (!source) issues.push({ level: "ERROR", rowNumber: row.rowNumber, sku, market: row.marketCode, code: "SOURCE_MARKET", message: `Unknown inventory source market ${sourceCode}` });
      }
      const existingVariant = existing?.variants.find((variant) => variant.sku === row.variantSku);
      const existingListing = existing?.listings.find((listing) => listing.marketId === market.id && listing.variantId === (existingVariant?.id ?? null))
        ?? existing?.listings.find((listing) => listing.marketId === market.id && existing?.variants.length === 1 && existing.variants[0].sku === row.variantSku);
      if (mode === "CREATE" && existingListing) {
        issues.push({ level: "ERROR", rowNumber: row.rowNumber, sku, market: row.marketCode, code: "LISTING_COLLISION", message: "CREATE cannot update an existing market listing" });
      }
      if (row.incomplete) {
        listings.push({ action: "unchanged", productSku: sku, variantSku: row.variantSku, marketCode: row.marketCode, rowNumbers: [row.rowNumber], diffs: [], incomplete: true });
        continue;
      }
      const cost = applyCell(row.cost, existingListing ? Number(existingListing.cost) : undefined);
      const price = applyCell(row.price, existingListing ? Number(existingListing.price) : undefined);
      const inventoryType = applyCell(row.inventoryType, existingListing?.inventoryType ?? "PHYSICAL_STOCK");
      const stock = applyCell(row.stock, existingListing?.currentStock ?? 0);
      const available = applyCell(row.available, existingListing?.available ?? true);
      const webPublicationStatus = applyCell(row.webPublicationStatus, existingListing?.webPublicationStatus ?? "DRAFT");
      const sourceCode = row.inventorySourceMarketCode.present
        ? row.inventorySourceMarketCode.clear
          ? null
          : (row.inventorySourceMarketCode.value ?? "").toUpperCase()
        : existingListing
          ? snapshot.markets.find((item) => item.id === existingListing.inventorySourceMarketId)?.code ?? null
          : null;
      let supplierName: string | null = existingListing ? snapshot.suppliers.find((item) => item.id === existingListing.supplierId)?.name ?? null : null;
      if (row.supplierName.present) {
        supplierName = row.supplierName.clear ? null : (row.supplierName.value ?? "").trim();
        if (supplierName) {
          const plan = supplierByName.get(normalizeSupplierName(supplierName));
          if (plan?.action === "ambiguous") {
            // already flagged
          }
        }
      }
      const listingDiffs = [
        diff("Cost", existingListing?.cost, cost.next == null ? null : Number(cost.next).toFixed(2), !existingListing),
        diff("Selling Price", existingListing?.price, price.next == null ? null : Number(price.next).toFixed(2), !existingListing),
        diff("Inventory Type", existingListing?.inventoryType, inventoryType.next ?? "PHYSICAL_STOCK", !existingListing),
        diff("Stock", existingListing?.currentStock, stock.touched || !existingListing ? stock.next ?? 0 : existingListing.currentStock, !existingListing),
        diff("Availability", existingListing?.available, available.next ?? true, !existingListing),
        diff("Web publication", existingListing?.webPublicationStatus, webPublicationStatus.next ?? "DRAFT", !existingListing),
        diff("Supplier", existingListing ? snapshot.suppliers.find((item) => item.id === existingListing.supplierId)?.name : null, supplierName, !existingListing),
        diff("Inventory source market", existingListing ? snapshot.markets.find((item) => item.id === existingListing.inventorySourceMarketId)?.code ?? null : null, sourceCode, !existingListing),
      ];
      listings.push({
        action: !existingListing ? "create" : listingDiffs.some((item) => item.status === "update") ? "update" : "unchanged",
        productSku: sku,
        variantSku: row.variantSku,
        marketCode: row.marketCode,
        rowNumbers: [row.rowNumber],
        diffs: listingDiffs,
        incomplete: false,
      });
    }

    products.push({
      action: productAction,
      productSku: sku,
      existingProductId: existing?.id ?? null,
      diffs: productDiffs,
      variants,
      listings,
    });
  }

  const errors = issues.filter((issue) => issue.level === "ERROR");
  const warnings = issues.filter((issue) => issue.level === "WARNING");
  const summary = {
    newProducts: products.filter((product) => product.action === "create").length,
    existingProductsUpdated: products.filter((product) => product.action === "update" || product.listings.some((listing) => listing.action === "update") || product.variants.some((variant) => variant.action === "update")).length,
    unchangedProducts: products.filter((product) => product.action === "unchanged" && product.listings.every((listing) => listing.action === "unchanged") && product.variants.every((variant) => variant.action === "unchanged")).length,
    newListings: products.flatMap((product) => product.listings).filter((listing) => listing.action === "create").length,
    updatedListings: products.flatMap((product) => product.listings).filter((listing) => listing.action === "update").length,
    unchangedListings: products.flatMap((product) => product.listings).filter((listing) => listing.action === "unchanged" && !listing.incomplete).length,
    awaitingSupplierCost: warnings.filter((issue) => issue.code === "AWAITING_COST").length,
    variantWarnings: warnings.filter((issue) => issue.code === "VARIANT_TOKEN").length,
    provenanceWarnings: warnings.filter((issue) => issue.code === "HIGH_COPY").length,
    blockingSkuCollisions: errors.filter((issue) => issue.code === "SKU_COLLISION" || issue.code === "VARIANT_COLLISION").length,
    errors: errors.length,
    warnings: warnings.length,
  };
  const hasApplyWork = products.some((product) => {
    const writable = product.listings.some((listing) => !listing.incomplete);
    return writable && (product.action !== "unchanged" || product.listings.some((listing) => !listing.incomplete && listing.action !== "unchanged") || product.variants.some((variant) => variant.action !== "unchanged"));
  });
  return {
    mode,
    fileSha256,
    sourceRows: rows.length,
    summary,
    suppliers,
    products,
    issues,
    canConfirm: errors.length === 0 && hasApplyWork,
  };
}
