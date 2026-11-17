import type { Gender, InventoryType, ProductStatus, WebPublicationStatus } from "@prisma/client";

export const CLEAR_TOKEN = "__CLEAR__";
export const MAX_IMPORT_BYTES = 2 * 1024 * 1024;
export const MAX_IMPORT_ROWS = 2000;
export const SKU_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,62}$/;

export type ImportMode = "CREATE" | "MERGE";

export type IssueLevel = "ERROR" | "WARNING";

export type ImportIssue = {
  level: IssueLevel;
  rowNumber: number;
  sku: string;
  market: string;
  code: string;
  message: string;
};

export type RawImportRow = {
  rowNumber: number;
  values: Record<string, string>;
};

export type ParsedImportRow = {
  rowNumber: number;
  productSku: string;
  variantSku: string;
  nameAr: Cell<string>;
  nameEn: Cell<string>;
  brand: Cell<string | null>;
  model: Cell<string | null>;
  gender: Cell<Gender>;
  departmentName: Cell<string | null>;
  categoryName: Cell<string | null>;
  color: Cell<string | null>;
  size: Cell<string | null>;
  material: Cell<string | null>;
  marketCode: string;
  currency: Cell<string>;
  cost: Cell<number>;
  price: Cell<number>;
  inventoryType: Cell<InventoryType>;
  stock: Cell<number>;
  available: Cell<boolean>;
  supplierName: Cell<string | null>;
  webPublicationStatus: Cell<WebPublicationStatus>;
  publicSlug: Cell<string | null>;
  internalNotes: Cell<string | null>;
  provenance: Cell<(typeof import("./cells").PROVENANCES)[number]>;
  productStatus: Cell<ProductStatus>;
  inventorySourceMarketCode: Cell<string | null>;
  listingNotes: Cell<string | null>;
  internalImageFilename: Cell<string | null>;
  publicMediaFilename: Cell<string | null>;
  incomplete: boolean;
};

export type Cell<T> = { present: false } | { present: true; clear: true } | { present: true; clear: false; value: T };

export type FieldDiff = {
  field: string;
  from: string;
  to: string;
  status: "unchanged" | "update" | "create";
};

export type ListingPlan = {
  action: "create" | "update" | "unchanged";
  productSku: string;
  variantSku: string;
  marketCode: string;
  rowNumbers: number[];
  diffs: FieldDiff[];
  incomplete: boolean;
};

export type ProductPlan = {
  action: "create" | "update" | "unchanged";
  productSku: string;
  existingProductId: string | null;
  diffs: FieldDiff[];
  variants: Array<{ action: "create" | "update" | "unchanged"; variantSku: string; diffs: FieldDiff[] }>;
  listings: ListingPlan[];
};

export type SupplierPlan = {
  name: string;
  action: "reuse" | "create" | "ambiguous";
  existingId: string | null;
};

export type ImportPreview = {
  mode: ImportMode;
  fileSha256: string;
  sourceRows: number;
  summary: {
    newProducts: number;
    existingProductsUpdated: number;
    unchangedProducts: number;
    newListings: number;
    updatedListings: number;
    unchangedListings: number;
    awaitingSupplierCost: number;
    variantWarnings: number;
    provenanceWarnings: number;
    blockingSkuCollisions: number;
    errors: number;
    warnings: number;
  };
  suppliers: SupplierPlan[];
  products: ProductPlan[];
  issues: ImportIssue[];
  canConfirm: boolean;
};

export type ImportApplyResult = {
  runId: string;
  mode: ImportMode;
  createdProducts: number;
  updatedProducts: number;
  unchangedProducts: number;
  createdVariants: number;
  createdListings: number;
  updatedListings: number;
  createdSuppliers: number;
  skippedIncomplete: number;
  protectedSkips: number;
};

export type CatalogueSnapshot = {
  markets: Array<{ id: string; code: string; currency: string }>;
  departments: Array<{ id: string; name: string }>;
  categories: Array<{ id: string; name: string; departmentId: string; archived: boolean }>;
  suppliers: Array<{ id: string; name: string }>;
  products: Array<{
    id: string;
    sku: string;
    nameAr: string;
    nameEn: string;
    brand: string | null;
    model: string | null;
    gender: Gender;
    provenance?: string | null;
    status: ProductStatus;
    publicSlug: string | null;
    internalNotes: string | null;
    departmentId: string | null;
    categoryId: string | null;
    variants: Array<{ id: string; sku: string; color: string | null; size: string | null; material: string | null }>;
    suppliers: Array<{ supplierId: string }>;
    listings: Array<{
      id: string;
      variantId: string | null;
      marketId: string;
      supplierId: string | null;
      cost: string;
      price: string;
      available: boolean;
      inventoryType: InventoryType;
      notes: string | null;
      webPublicationStatus: WebPublicationStatus;
      inventorySourceMarketId: string | null;
      currentStock: number;
    }>;
  }>;
};
