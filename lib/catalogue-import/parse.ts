import { createHash } from "node:crypto";
import * as XLSX from "xlsx";
import { canonicalHeader } from "./columns";
import {
  GENDERS,
  INVENTORY_TYPES,
  PRODUCT_STATUSES,
  PROVENANCES,
  WEB_STATUSES,
  parseAvailability,
  parseEnum,
  parseFilename,
  parseMoney,
  parseSku,
  parseStock,
  presentCell,
  rawCell,
} from "./cells";
import { MAX_IMPORT_BYTES, MAX_IMPORT_ROWS, type ImportIssue, type ParsedImportRow, type RawImportRow } from "./types";

export function parseWorkbook(buffer: Buffer, filename: string) {
  const lower = filename.toLowerCase();
  if (!lower.endsWith(".csv") && !lower.endsWith(".xlsx")) {
    throw new Error("Only .csv and .xlsx files are accepted");
  }
  if (buffer.byteLength > MAX_IMPORT_BYTES) throw new Error(`File exceeds ${MAX_IMPORT_BYTES / 1024 / 1024} MB`);
  const workbook = XLSX.read(buffer, { type: "buffer", raw: false, cellFormula: false, cellHTML: false });
  const sheetName = workbook.SheetNames.find((name) => name.toLowerCase() !== "readme") ?? workbook.SheetNames[0];
  if (!sheetName) throw new Error("Spreadsheet has no sheets");
  const sheet = workbook.Sheets[sheetName];
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: false, defval: "" });
  if (!matrix.length) throw new Error("Spreadsheet is empty");
  const headers = (matrix[0] ?? []).map((header) => canonicalHeader(rawCell(header)));
  if (!headers.some((header) => header === "Product SKU" || header === "SKU")) {
    throw new Error("A Product SKU or SKU column is required");
  }
  const rows: RawImportRow[] = [];
  for (let index = 1; index < matrix.length; index += 1) {
    const line = matrix[index] ?? [];
    if (line.every((cell) => !rawCell(cell))) continue;
    const values: Record<string, string> = {};
    headers.forEach((header, column) => {
      if (!header) return;
      values[header] = rawCell(line[column]);
    });
    rows.push({ rowNumber: index + 1, values });
  }
  if (rows.length > MAX_IMPORT_ROWS) throw new Error(`Row count exceeds ${MAX_IMPORT_ROWS}`);
  return { rows, fileSha256: createHash("sha256").update(buffer).digest("hex") };
}

function moneyCell(raw: string, label: string, issues: ImportIssue[], rowNumber: number, sku: string, market: string) {
  const cell = presentCell(raw);
  if (!cell.present) return cell;
  if (cell.clear) {
    issues.push({ level: "ERROR", rowNumber, sku, market, code: "CLEAR_FORBIDDEN", message: `${label} is required by schema and cannot be cleared` });
    return { present: false } as const;
  }
  const parsed = parseMoney(cell.value, label);
  if (!parsed.ok) {
    issues.push({ level: "ERROR", rowNumber, sku, market, code: "MONEY", message: parsed.message });
    return { present: false } as const;
  }
  return { present: true as const, clear: false as const, value: parsed.value };
}

export function parseRows(rawRows: RawImportRow[]) {
  const issues: ImportIssue[] = [];
  const rows: ParsedImportRow[] = [];
  for (const raw of rawRows) {
    const values = raw.values;
    const productSkuRaw = values["Product SKU"] || "";
    const variantFromExport = values["Variant"] || "";
    const skuParse = parseSku(productSkuRaw);
    const productSku = skuParse.ok ? skuParse.value : productSkuRaw;
    if (!skuParse.ok) {
      issues.push({ level: "ERROR", rowNumber: raw.rowNumber, sku: productSkuRaw, market: values.Market || "", code: "SKU", message: skuParse.message });
    }
    const variantSkuRaw = values["Variant SKU"] || "";
    let variantSku = productSku;
    if (variantSkuRaw) {
      const parsedVariant = parseSku(variantSkuRaw);
      if (!parsedVariant.ok) issues.push({ level: "ERROR", rowNumber: raw.rowNumber, sku: productSku, market: values.Market || "", code: "VARIANT_SKU", message: parsedVariant.message });
      else variantSku = parsedVariant.value;
    }
    const marketCode = (values.Market || "").trim().toUpperCase();
    if (!["EGYPT", "MOROCCO"].includes(marketCode)) {
      issues.push({ level: "ERROR", rowNumber: raw.rowNumber, sku: productSku, market: values.Market || "", code: "MARKET", message: "Market must be EGYPT or MOROCCO" });
    }

    const color = presentCell(values.Color);
    const size = presentCell(values.Size);
    const material = presentCell(values.Material);
    if (!color.present && !size.present && !material.present && variantFromExport) {
      const parts = variantFromExport.split(" / ").map((part) => part.trim()).filter(Boolean);
      if (parts[0]) Object.assign(color, { present: true, clear: false, value: parts[0] });
      if (parts[1]) Object.assign(size, { present: true, clear: false, value: parts[1] });
      if (parts[2]) Object.assign(material, { present: true, clear: false, value: parts[2] });
    }

    const costRaw = values.Cost || "";
    const priceRaw = values["Selling Price"] || "";
    const incomplete = !costRaw || !priceRaw;
    if (!costRaw) {
      issues.push({ level: "WARNING", rowNumber: raw.rowNumber, sku: productSku, market: marketCode, code: "AWAITING_COST", message: "Cost is missing; row will stay outside the database" });
    } else if (costRaw === "0" || costRaw === "0.0" || costRaw === "0.00") {
      issues.push({ level: "WARNING", rowNumber: raw.rowNumber, sku: productSku, market: marketCode, code: "ZERO_COST", message: "Cost is explicitly 0; this is stored only because the spreadsheet supplied 0" });
    }
    if (!priceRaw) {
      issues.push({ level: "WARNING", rowNumber: raw.rowNumber, sku: productSku, market: marketCode, code: "AWAITING_PRICE", message: "Selling price is missing; row will stay outside the database" });
    }

    const inventoryTypeCell = presentCell(values["Inventory Type"]);
    let inventoryType: ParsedImportRow["inventoryType"] = { present: false };
    if (inventoryTypeCell.present && inventoryTypeCell.clear) inventoryType = inventoryTypeCell;
    else if (inventoryTypeCell.present) {
      const parsed = parseEnum(inventoryTypeCell.value, INVENTORY_TYPES, "Inventory Type");
      if (!parsed.ok) issues.push({ level: "ERROR", rowNumber: raw.rowNumber, sku: productSku, market: marketCode, code: "INVENTORY_TYPE", message: parsed.message });
      else inventoryType = { present: true, clear: false, value: parsed.value };
    }

    const genderCell = presentCell(values.Gender);
    let gender: ParsedImportRow["gender"] = { present: false };
    if (genderCell.present && genderCell.clear) {
      issues.push({ level: "ERROR", rowNumber: raw.rowNumber, sku: productSku, market: marketCode, code: "CLEAR_FORBIDDEN", message: "Gender cannot be cleared" });
    } else if (genderCell.present) {
      const parsed = parseEnum(genderCell.value, GENDERS, "Gender");
      if (!parsed.ok) issues.push({ level: "ERROR", rowNumber: raw.rowNumber, sku: productSku, market: marketCode, code: "GENDER", message: parsed.message });
      else gender = { present: true, clear: false, value: parsed.value };
    }

    const webCell = presentCell(values["Web Publication Status"]);
    let webPublicationStatus: ParsedImportRow["webPublicationStatus"] = { present: false };
    if (webCell.present && webCell.clear) {
      issues.push({ level: "ERROR", rowNumber: raw.rowNumber, sku: productSku, market: marketCode, code: "CLEAR_FORBIDDEN", message: "Web publication status cannot be cleared" });
    } else if (webCell.present) {
      const parsed = parseEnum(webCell.value, WEB_STATUSES, "Web Publication Status");
      if (!parsed.ok) issues.push({ level: "ERROR", rowNumber: raw.rowNumber, sku: productSku, market: marketCode, code: "WEB_STATUS", message: parsed.message });
      else webPublicationStatus = { present: true, clear: false, value: parsed.value };
    }

    const provenanceCell = presentCell(values.Provenance);
    let provenance: ParsedImportRow["provenance"] = { present: false };
    if (provenanceCell.present && provenanceCell.clear) {
      issues.push({ level: "ERROR", rowNumber: raw.rowNumber, sku: productSku, market: marketCode, code: "CLEAR_FORBIDDEN", message: "Provenance cannot be cleared" });
    } else if (provenanceCell.present) {
      const parsed = parseEnum(provenanceCell.value, PROVENANCES, "Provenance");
      if (!parsed.ok) issues.push({ level: "ERROR", rowNumber: raw.rowNumber, sku: productSku, market: marketCode, code: "PROVENANCE", message: parsed.message });
      else {
        provenance = { present: true, clear: false, value: parsed.value };
        if (parsed.value === "HIGH_COPY") {
          issues.push({ level: "WARNING", rowNumber: raw.rowNumber, sku: productSku, market: marketCode, code: "HIGH_COPY", message: "HIGH_COPY is internal only and will never become a customer-facing originality claim" });
        }
      }
    }

    const statusCell = presentCell(values["Product Status"]);
    let productStatus: ParsedImportRow["productStatus"] = { present: false };
    if (statusCell.present && !statusCell.clear) {
      const parsed = parseEnum(statusCell.value, PRODUCT_STATUSES, "Product Status");
      if (!parsed.ok) issues.push({ level: "ERROR", rowNumber: raw.rowNumber, sku: productSku, market: marketCode, code: "PRODUCT_STATUS", message: parsed.message });
      else productStatus = { present: true, clear: false, value: parsed.value };
    }

    const stockCell = presentCell(values.Stock);
    let stock: ParsedImportRow["stock"] = { present: false };
    if (stockCell.present && stockCell.clear) {
      issues.push({ level: "ERROR", rowNumber: raw.rowNumber, sku: productSku, market: marketCode, code: "CLEAR_FORBIDDEN", message: "Stock cannot be cleared" });
    } else if (stockCell.present) {
      const parsed = parseStock(stockCell.value);
      if (!parsed.ok) issues.push({ level: "ERROR", rowNumber: raw.rowNumber, sku: productSku, market: marketCode, code: "STOCK", message: parsed.message });
      else stock = { present: true, clear: false, value: parsed.value };
    }

    const availableCell = presentCell(values.Availability);
    let available: ParsedImportRow["available"] = { present: false };
    if (availableCell.present && availableCell.clear) {
      issues.push({ level: "ERROR", rowNumber: raw.rowNumber, sku: productSku, market: marketCode, code: "CLEAR_FORBIDDEN", message: "Availability cannot be cleared" });
    } else if (availableCell.present) {
      const parsed = parseAvailability(availableCell.value);
      if (!parsed.ok) issues.push({ level: "ERROR", rowNumber: raw.rowNumber, sku: productSku, market: marketCode, code: "AVAILABILITY", message: parsed.message });
      else available = { present: true, clear: false, value: parsed.value };
    }

    const currencyCell = presentCell(values.Currency);
    let currency: ParsedImportRow["currency"] = { present: false };
    if (currencyCell.present && currencyCell.clear) {
      issues.push({ level: "ERROR", rowNumber: raw.rowNumber, sku: productSku, market: marketCode, code: "CLEAR_FORBIDDEN", message: "Currency cannot be cleared" });
    } else if (currencyCell.present) {
      currency = { present: true, clear: false, value: currencyCell.value.toUpperCase() };
    }

    const publicSlug = presentCell(values["Public Slug"]);
    if (webPublicationStatus.present && !webPublicationStatus.clear && webPublicationStatus.value === "PUBLISHED" && (!publicSlug.present || publicSlug.clear || !("value" in publicSlug))) {
      issues.push({ level: "ERROR", rowNumber: raw.rowNumber, sku: productSku, market: marketCode, code: "PUBLISH_SLUG", message: "PUBLISHED listings require a public slug" });
    }

    for (const [label, filename] of [["Internal Image Filename", values["Internal Image Filename"]], ["Public Media Filename", values["Public Media Filename"]]] as const) {
      const cell = presentCell(filename || "");
      if (cell.present && !cell.clear) {
        const parsed = parseFilename(cell.value);
        if (!parsed.ok) issues.push({ level: "ERROR", rowNumber: raw.rowNumber, sku: productSku, market: marketCode, code: "FILENAME", message: `${label}: ${parsed.message}` });
        else issues.push({ level: "WARNING", rowNumber: raw.rowNumber, sku: productSku, market: marketCode, code: "MEDIA_DEFERRED", message: `${label} accepted for a future ZIP workflow; v1.0 does not upload media` });
      }
    }

    rows.push({
      rowNumber: raw.rowNumber,
      productSku,
      variantSku,
      nameAr: presentCell(values["Name AR"] || ""),
      nameEn: presentCell(values["Name EN"] || ""),
      brand: presentCell(values.Brand || ""),
      model: presentCell(values.Model || ""),
      gender,
      departmentName: presentCell(values.Department || ""),
      categoryName: presentCell(values.Category || ""),
      color,
      size,
      material,
      marketCode,
      currency,
      cost: incomplete && !costRaw ? { present: false } : moneyCell(costRaw, "Cost", issues, raw.rowNumber, productSku, marketCode),
      price: incomplete && !priceRaw ? { present: false } : moneyCell(priceRaw, "Selling Price", issues, raw.rowNumber, productSku, marketCode),
      inventoryType,
      stock,
      available,
      supplierName: presentCell(values.Supplier || ""),
      webPublicationStatus,
      publicSlug,
      internalNotes: presentCell(values["Internal Notes"] || ""),
      provenance,
      productStatus,
      inventorySourceMarketCode: presentCell(values["Inventory Source Market"] || ""),
      listingNotes: { present: false },
      internalImageFilename: presentCell(values["Internal Image Filename"] || ""),
      publicMediaFilename: presentCell(values["Public Media Filename"] || ""),
      incomplete,
    });
  }
  return { rows, issues };
}
