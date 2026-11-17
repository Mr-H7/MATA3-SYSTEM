import * as XLSX from "xlsx";
import { TEMPLATE_COLUMNS } from "./columns";
import { csvSafe, sheetSafe } from "./formula-guard";

const README = [
  ["MATA3 Bulk Catalogue Import v1.0"],
  ["One row = one variant × one market listing. Repeat the product SKU for Egypt and Morocco."],
  ["CREATE adds new SKUs only. MERGE updates existing SKUs and may also create new ones."],
  ["Blank MERGE cells leave the current value unchanged. Use __CLEAR__ to clear a nullable field."],
  ["Cost and selling price cannot be blank for rows that should be written. Missing cost is kept outside the database; 0 is never inferred."],
  ["New listings default to webPublicationStatus=DRAFT. Missing public slug is allowed for DRAFT only."],
  ["Provenance is internal staff classification and is never shown to customers automatically."],
  ["Inventory Source Market is optional. Leave blank to avoid inventing cross-market sourcing."],
  ["Image filename columns are accepted for a future ZIP workflow and do not upload media in v1.0."],
  ["Existing owner export columns (SKU, Product Name, Variant, Notes, Status) are also accepted."],
];

export function buildImportTemplate() {
  const workbook = XLSX.utils.book_new();
  const example = [{
    "Product SKU": "IMP-EXAMPLE-001",
    "Variant SKU": "IMP-EXAMPLE-001",
    "Name AR": "",
    "Name EN": "Example Mechanical Keyboard",
    Brand: "T-Dagger",
    Model: "T-TGK313",
    Gender: "NA",
    Department: "",
    Category: "",
    Color: "BLACK",
    Size: "",
    Material: "",
    Market: "EGYPT",
    Currency: "EGP",
    Cost: 800,
    "Selling Price": 999,
    "Inventory Type": "PHYSICAL_STOCK",
    Stock: 1,
    Availability: "Yes",
    Supplier: "Example Supplier",
    "Web Publication Status": "DRAFT",
    "Public Slug": "",
    "Internal Notes": "",
    Provenance: "UNVERIFIED",
    "Inventory Source Market": "",
    "Internal Image Filename": "",
    "Public Media Filename": "",
  }];
  const sheet = XLSX.utils.json_to_sheet(example, { header: [...TEMPLATE_COLUMNS] });
  XLSX.utils.book_append_sheet(workbook, sheet, "Catalogue");
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(README.map((row) => row.map(sheetSafe))), "README");
  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

export function issuesCsv(issues: Array<{ rowNumber: number; sku: string; market: string; level: string; code: string; message: string }>) {
  const header = ["Row", "SKU", "Market", "Level", "Code", "Message"];
  const lines = [header.map(csvSafe).join(",")];
  for (const issue of issues) {
    lines.push([issue.rowNumber, issue.sku, issue.market, issue.level, issue.code, issue.message].map(csvSafe).join(","));
  }
  return `\uFEFF${lines.join("\r\n")}`;
}
