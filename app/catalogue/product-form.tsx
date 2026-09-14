"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { isFashionShoeContext, quickShoeSizes } from "@/lib/fashion-sizes";

type Option = { id: string; name: string; departmentId?: string };
type Variant = { id?: string; sku: string; color: string; size: string; material: string; supplierCode: string; barcode: string };
type Listing = {
  id?: string;
  marketCode: string;
  variantSku: string;
  supplierId: string;
  cost: number;
  price: number;
  compareAt: number | null;
  available: boolean;
  inventoryType: string;
  minimumStock: number;
  notes: string;
  stock?: number;
  inventorySourceMarketCode: string;
};
type ProductImage = { id: string; url: string; alt?: string | null; isPrimary: boolean };
type Value = {
  id?: string;
  sku: string;
  nameAr: string;
  nameEn: string;
  descriptionAr: string;
  descriptionEn: string;
  departmentId: string;
  categoryId: string;
  brand: string;
  model: string;
  gender: string;
  status: string;
  internalNotes: string;
  publicSlug?: string;
  variants: Variant[];
  listings: Listing[];
  images?: ProductImage[];
};

function defaultListing(marketCode: string, variantSku = ""): Listing {
  return {
    marketCode,
    variantSku,
    supplierId: "",
    cost: 0,
    price: 0,
    compareAt: null,
    available: true,
    inventoryType: "PHYSICAL_STOCK",
    minimumStock: 0,
    notes: "",
    stock: 0,
    inventorySourceMarketCode: marketCode,
  };
}

export default function ProductForm({
  initial,
  departments,
  categories,
  suppliers,
}: {
  initial?: Value;
  departments: Option[];
  categories: Option[];
  suppliers: Array<Option & { marketCode: string | null }>;
}) {
  const router = useRouter();
  const [value, setValue] = useState<Value>(
    initial ?? {
      sku: "",
      nameAr: "",
      nameEn: "",
      descriptionAr: "",
      descriptionEn: "",
      departmentId: "",
      categoryId: "",
      brand: "",
      model: "",
      gender: "NA",
      status: "DRAFT",
      internalNotes: "",
      publicSlug: "",
      variants: [],
      listings: [],
      images: [],
    },
  );
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [productId, setProductId] = useState(initial?.id ?? "");
  const [pendingImage, setPendingImage] = useState<File | null>(null);
  const [pendingPreview, setPendingPreview] = useState("");

  const departmentName = departments.find((d) => d.id === value.departmentId)?.name;
  const categoryName = categories.find((c) => c.id === value.categoryId)?.name;
  const showShoeSizes = isFashionShoeContext(departmentName, categoryName);
  const shoeQuickSizes = quickShoeSizes(value.gender);

  const filteredCategories = useMemo(
    () => categories.filter((option) => !value.departmentId || option.departmentId === value.departmentId),
    [categories, value.departmentId],
  );

  function addVariant() {
    setValue({ ...value, variants: [...value.variants, { sku: "", color: "", size: "", material: "", supplierCode: "", barcode: "" }] });
  }

  function addListing(marketCode: "EGYPT" | "MOROCCO") {
    const variantSku = value.variants.length === 1 ? value.variants[0].sku : "";
    setValue({ ...value, listings: [...value.listings, defaultListing(marketCode, variantSku)] });
  }

  function addListingsForVariants(marketCode: "EGYPT" | "MOROCCO") {
    const additions = value.variants
      .filter((variant) => variant.sku.trim())
      .filter(
        (variant) =>
          !value.listings.some(
            (listing) => listing.marketCode === marketCode && listing.variantSku === variant.sku,
          ),
      )
      .map((variant) => defaultListing(marketCode, variant.sku));
    setValue({ ...value, listings: [...value.listings, ...additions] });
  }

  function applyQuickSizes(selectedSizes: string[]) {
    const baseSku = value.sku.trim() || "SKU";
    const color = value.variants[0]?.color || "STD";
    const nextVariants = selectedSizes.map((size) => {
      const existing = value.variants.find((variant) => variant.size === size);
      const sku = existing?.sku || `${baseSku}-${color}-${size}`.replace(/\s+/g, "-").toUpperCase();
      return existing ?? { sku, color, size, material: "", supplierCode: "", barcode: "" };
    });
    setValue({ ...value, variants: nextVariants });
  }

  function toggleQuickSize(size: string) {
    const has = value.variants.some((variant) => variant.size === size);
    const next = has ? value.variants.filter((variant) => variant.size !== size) : [...value.variants, { sku: `${value.sku || "SKU"}-${size}`, color: value.variants[0]?.color || "", size, material: "", supplierCode: "", barcode: "" }];
    setValue({ ...value, variants: next });
  }

  async function save() {
    setSaving(true);
    setError("");
    const response = await fetch(productId ? `/api/products/${productId}` : "/api/products", {
      method: productId ? "PATCH" : "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(value),
    });
    const result = await response.json();
    if (!response.ok) {
      setSaving(false);
      return setError(result.error || "Save failed");
    }
    const savedProductId = productId || result.id;
    setProductId(savedProductId);
    if (pendingImage) {
      const uploadResult = await uploadImageForProduct(pendingImage, savedProductId);
      if (!uploadResult) {
        setSaving(false);
        return;
      }
    }
    setSaving(false);
    router.push(`/catalogue/${savedProductId}`);
    router.refresh();
  }

  async function uploadImageForProduct(file: File, targetProductId: string) {
    const form = new FormData();
    form.set("file", file);
    const response = await fetch(`/api/products/${targetProductId}/images`, { method: "POST", body: form });
    const result = await response.json();
    if (!response.ok) {
      setError(result.error || "Upload failed");
      return null;
    }
    setPendingImage(null);
    setPendingPreview("");
    setValue((current) => ({ ...current, images: [result, ...(current.images ?? []).filter((image) => image.id !== result.id)] }));
    return result as ProductImage;
  }

  async function uploadImage(file: File) {
    if (!productId) {
      if (pendingPreview) URL.revokeObjectURL(pendingPreview);
      setPendingImage(file);
      setPendingPreview(URL.createObjectURL(file));
      return;
    }
    setUploading(true);
    setError("");
    await uploadImageForProduct(file, productId);
    setUploading(false);
  }

  async function removeImage(imageId: string) {
    if (!productId) return;
    const response = await fetch(`/api/products/${productId}/images`, { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ imageId }) });
    if (!response.ok) return setError((await response.json()).error || "Delete failed");
    setValue({ ...value, images: (value.images ?? []).filter((image) => image.id !== imageId) });
  }

  const primaryImage = value.images?.find((image) => image.isPrimary) ?? value.images?.[0];

  return (
    <div className="bg-white border rounded p-5 space-y-6">
      <section className="grid md:grid-cols-2 gap-3">
        {(
          [
            ["sku", "SKU"],
            ["nameEn", "Name (English)"],
            ["nameAr", "Name (Arabic)"],
            ["descriptionEn", "Description (English)"],
            ["descriptionAr", "Description (Arabic)"],
            ["brand", "Brand"],
            ["model", "Model"],
            ["publicSlug", "Public slug (website)"],
            ["internalNotes", "Internal notes"],
          ] as const
        ).map(([field, label]) => (
          <label key={field} className="text-sm font-semibold">
            {label}
            <input className="form-control mt-1" value={(value[field] as string) ?? ""} onChange={(event) => setValue({ ...value, [field]: event.target.value })} />
          </label>
        ))}
        <label className="text-sm font-semibold">
          Department
          <select className="form-control mt-1" value={value.departmentId} onChange={(event) => setValue({ ...value, departmentId: event.target.value, categoryId: "" })}>
            <option value="">None</option>
            {departments.map((option) => (
              <option value={option.id} key={option.id}>
                {option.name}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm font-semibold">
          Category
          <select className="form-control mt-1" value={value.categoryId} onChange={(event) => setValue({ ...value, categoryId: event.target.value })}>
            <option value="">None</option>
            {filteredCategories.map((option) => (
              <option value={option.id} key={option.id}>
                {option.name}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm font-semibold">
          Gender
          <select className="form-control mt-1" value={value.gender} onChange={(event) => setValue({ ...value, gender: event.target.value })}>
            {["NA", "MEN", "WOMEN", "KIDS", "UNISEX"].map((option) => (
              <option key={option}>{option}</option>
            ))}
          </select>
        </label>
        <label className="text-sm font-semibold">
          Status
          <select className="form-control mt-1" value={value.status} onChange={(event) => setValue({ ...value, status: event.target.value })}>
            {["DRAFT", "ACTIVE", "HIDDEN", "OUT_OF_STOCK", "COMING_SOON", "ARCHIVED"].map((option) => (
              <option key={option}>{option}</option>
            ))}
          </select>
        </label>
      </section>

      <section className="border rounded p-4">
        <h2 className="font-bold">Product image · صورة المنتج</h2>
        <div className="mt-3 flex flex-wrap items-start gap-4">
          <div className="h-24 w-24 rounded border bg-[#f7eee7] overflow-hidden flex items-center justify-center text-xs text-[#6e685e]">
            {pendingPreview ? <Image unoptimized src={pendingPreview} alt="Pending product preview" width={96} height={96} className="h-full w-full object-cover" /> : primaryImage ? <Image unoptimized src={primaryImage.url} alt={primaryImage.alt || value.nameEn} width={96} height={96} className="h-full w-full object-cover" /> : "No image"}
          </div>
          <div>
            <input type="file" accept="image/jpeg,image/png,image/webp,image/gif" disabled={uploading} onChange={(event) => { const file = event.target.files?.[0]; if (file) uploadImage(file); event.target.value = ""; }} />
            <p className="text-xs text-[#6e685e] mt-1">JPEG, PNG, WebP or GIF · max 5 MB</p>
            {(value.images ?? []).map((image) => (
              <div key={image.id} className="mt-2 flex items-center gap-2 text-sm">
                <span className="truncate max-w-xs">{image.url}</span>
                <button type="button" className="text-red-700 underline" onClick={() => removeImage(image.id)}>
                  Remove
                </button>
              </div>
            ))}
          </div>
        </div>
      </section>

      {showShoeSizes && shoeQuickSizes.length ? (
        <section className="border rounded p-4">
          <h2 className="font-bold">Available sizes · المقاسات المتاحة</h2>
          <div className="mt-2 flex flex-wrap gap-2">
            {shoeQuickSizes.map((size) => {
              const active = value.variants.some((variant) => variant.size === size);
              return (
                <button type="button" key={size} className={`btn ${active ? "btn-gold" : "btn-secondary"} !min-h-9 !px-3`} onClick={() => toggleQuickSize(size)}>
                  {size}
                </button>
              );
            })}
          </div>
          <button type="button" className="btn btn-secondary mt-3 !min-h-8" onClick={() => applyQuickSizes([...shoeQuickSizes])}>
            Select all suggested sizes
          </button>
        </section>
      ) : null}

      <section>
        <div className="flex justify-between items-center">
          <h2 className="font-bold">Variants</h2>
          <button className="btn btn-secondary !min-h-8" type="button" onClick={addVariant}>
            + Variant
          </button>
        </div>
        {value.variants.map((variant, index) => (
          <div className="grid md:grid-cols-3 gap-2 mt-2" key={variant.id ?? index}>
            {(["sku", "color", "size", "material", "supplierCode", "barcode"] as const).map((field) => (
              <input
                className="form-control"
                placeholder={field}
                value={variant[field]}
                onChange={(event) => {
                  const variants = [...value.variants];
                  variants[index] = { ...variant, [field]: event.target.value };
                  setValue({ ...value, variants });
                }}
                key={field}
              />
            ))}
          </div>
        ))}
      </section>

      <section>
        <div className="flex gap-2 items-center flex-wrap">
          <h2 className="font-bold mr-auto">Market listings</h2>
          <button type="button" className="btn btn-secondary !min-h-8" onClick={() => addListing("EGYPT")}>
            + Egypt
          </button>
          <button type="button" className="btn btn-secondary !min-h-8" onClick={() => addListing("MOROCCO")}>
            + Morocco
          </button>
          {value.variants.length > 1 ? (
            <>
              <button type="button" className="btn btn-secondary !min-h-8" onClick={() => addListingsForVariants("EGYPT")}>
                + Egypt for all variants
              </button>
              <button type="button" className="btn btn-secondary !min-h-8" onClick={() => addListingsForVariants("MOROCCO")}>
                + Morocco for all variants
              </button>
            </>
          ) : null}
        </div>
        {value.listings.map((listing, index) => (
          <div className="border rounded p-3 mt-3 grid md:grid-cols-4 gap-2" key={listing.id ?? index}>
            <b className="col-span-full">{listing.marketCode} · {listing.marketCode === "EGYPT" ? "EGP" : "MAD"}</b>
            <label className="text-sm">
              Variant
              <select className="form-control mt-1" value={listing.variantSku} onChange={(event) => { const listings = [...value.listings]; listings[index] = { ...listing, variantSku: event.target.value }; setValue({ ...value, listings }); }}>
                <option value="">No variant</option>
                {value.variants.map((variant) => (
                  <option key={variant.sku} value={variant.sku}>
                    {variant.sku} {variant.size ? `(Size ${variant.size})` : ""}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm">
              Supplier
              <select className="form-control mt-1" value={listing.supplierId} onChange={(event) => { const listings = [...value.listings]; listings[index] = { ...listing, supplierId: event.target.value }; setValue({ ...value, listings }); }}>
                <option value="">None</option>
                {suppliers.filter((supplier) => !supplier.marketCode || supplier.marketCode === listing.marketCode).map((supplier) => (
                  <option value={supplier.id} key={supplier.id}>
                    {supplier.name}
                  </option>
                ))}
              </select>
            </label>
            {(["cost", "price", "minimumStock"] as const).map((field) => (
              <label key={field} className="text-sm capitalize">
                {field === "minimumStock" ? "Minimum Stock" : field.charAt(0).toUpperCase() + field.slice(1)}
                <input className="form-control mt-1" type="number" min="0" step={field === "minimumStock" ? 1 : "0.01"} value={listing[field]} onChange={(event) => { const listings = [...value.listings]; listings[index] = { ...listing, [field]: Number(event.target.value) }; setValue({ ...value, listings }); }} />
              </label>
            ))}
            {!initial && (
              <label className="text-sm">
                Opening Stock
                <input className="form-control mt-1" type="number" min="0" step="1" value={listing.stock ?? 0} onChange={(event) => { const listings = [...value.listings]; listings[index] = { ...listing, stock: Number(event.target.value) }; setValue({ ...value, listings }); }} />
              </label>
            )}
            <label className="text-sm">
              Inventory Type
              <select className="form-control mt-1" value={listing.inventoryType} onChange={(event) => { const listings = [...value.listings]; listings[index] = { ...listing, inventoryType: event.target.value }; setValue({ ...value, listings }); }}>
                {["PHYSICAL_STOCK", "ON_DEMAND", "SUPPLIER_STOCK", "PREORDER"].map((option) => (
                  <option key={option}>{option}</option>
                ))}
              </select>
            </label>
            <label className="text-sm">
              Inventory Source · مصدر المخزون
              <select className="form-control mt-1" value={listing.inventorySourceMarketCode || listing.marketCode} onChange={(event) => { const listings = [...value.listings]; listings[index] = { ...listing, inventorySourceMarketCode: event.target.value }; setValue({ ...value, listings }); }}>
                <option value={listing.marketCode}>{listing.marketCode === "EGYPT" ? "Egypt" : "Morocco"}</option>
                <option value={listing.marketCode === "EGYPT" ? "MOROCCO" : "EGYPT"}>{listing.marketCode === "EGYPT" ? "Morocco" : "Egypt"}</option>
              </select>
            </label>
            <label className="flex gap-2 items-center text-sm col-span-full">
              <input type="checkbox" checked={listing.available} onChange={(event) => { const listings = [...value.listings]; listings[index] = { ...listing, available: event.target.checked }; setValue({ ...value, listings }); }} /> Available
            </label>
            <label className="text-sm col-span-full">
              Notes
              <input className="form-control mt-1" value={listing.notes} onChange={(event) => { const listings = [...value.listings]; listings[index] = { ...listing, notes: event.target.value }; setValue({ ...value, listings }); }} />
            </label>
          </div>
        ))}
      </section>

      {initial && <p className="text-sm text-gray-500">Stock is adjusted only from Inventory; this form does not overwrite stock.</p>}
      {error && <p className="text-red-600 text-sm">{error}</p>}
      <button disabled={saving} onClick={save} className="btn btn-gold">
        {saving ? "Saving…" : "Save Product"}
      </button>
    </div>
  );
}
