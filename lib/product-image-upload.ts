import { randomUUID } from "node:crypto";

const ALLOWED_MIME = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
const MAX_BYTES = 5 * 1024 * 1024;

function detectedMime(bytes: Uint8Array) {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (
    bytes.length >= 8 &&
    [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((byte, index) => bytes[index] === byte)
  ) return "image/png";
  const header = new TextDecoder("ascii").decode(bytes.slice(0, 12));
  if (header.startsWith("GIF87a") || header.startsWith("GIF89a")) return "image/gif";
  if (header.startsWith("RIFF") && header.slice(8, 12) === "WEBP") return "image/webp";
  return null;
}

export async function validateImageUpload(file: File) {
  if (!ALLOWED_MIME.has(file.type)) return "Unsupported image type. Use JPEG, PNG, WebP, or GIF.";
  if (file.size <= 0 || file.size > MAX_BYTES) return "Image must be between 1 byte and 5 MB.";
  const bytes = new Uint8Array(await file.arrayBuffer());
  const actualMime = detectedMime(bytes);
  if (!actualMime || actualMime !== file.type) return "Image contents do not match the submitted image type.";
  return null;
}

export async function storeProductImage(file: File, productId: string) {
  const error = await validateImageUpload(file);
  if (error) throw new Error(error);

  const token = process.env.BLOB_READ_WRITE_TOKEN;
  const extension = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : file.type === "image/gif" ? "gif" : "jpg";
  const filename = `${randomUUID()}.${extension}`;
  const key = `products/${productId}/${filename}`;

  if (token) {
    const { put } = await import("@vercel/blob");
    const blob = await put(key, file, {
      access: "public",
      token,
      addRandomSuffix: false,
      contentType: file.type,
    });
    return blob.url;
  }

  if (process.env.NODE_ENV === "production") {
    throw new Error("Image storage is not configured (BLOB_READ_WRITE_TOKEN missing)");
  }

  const { writeFile, mkdir } = await import("node:fs/promises");
  const { join } = await import("node:path");
  const directory = join(process.cwd(), "public", "uploads", "products", productId);
  await mkdir(directory, { recursive: true });
  const bytes = Buffer.from(await file.arrayBuffer());
  await writeFile(join(directory, filename), bytes);
  return `/uploads/products/${productId}/${filename}`;
}

export async function deleteProductImage(url: string, productId: string) {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (token && /^https:\/\/[^/]+\.public\.blob\.vercel-storage\.com\//.test(url)) {
    const { del } = await import("@vercel/blob");
    await del(url, { token });
    return;
  }
  const prefix = `/uploads/products/${productId}/`;
  if (!url.startsWith(prefix)) return;
  const filename = url.slice(prefix.length);
  if (!/^[a-f0-9-]+\.(?:jpg|png|webp|gif)$/i.test(filename)) return;
  const { unlink } = await import("node:fs/promises");
  const { join } = await import("node:path");
  try {
    await unlink(join(process.cwd(), "public", "uploads", "products", productId, filename));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}
