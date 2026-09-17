import { randomUUID } from "node:crypto";
const types: Record<string, { ext: string; max: number; matches: (bytes: Uint8Array) => boolean }> = {
  "image/jpeg": { ext: "jpg", max: 5_000_000, matches: b => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  "image/png": { ext: "png", max: 5_000_000, matches: b => [0x89,0x50,0x4e,0x47].every((v,i) => b[i] === v) },
  "image/webp": { ext: "webp", max: 5_000_000, matches: b => new TextDecoder().decode(b.slice(0,4)) === "RIFF" && new TextDecoder().decode(b.slice(8,12)) === "WEBP" },
  "video/mp4": { ext: "mp4", max: 50_000_000, matches: b => new TextDecoder().decode(b.slice(4,8)) === "ftyp" },
  "video/webm": { ext: "webm", max: 50_000_000, matches: b => [0x1a,0x45,0xdf,0xa3].every((v,i) => b[i] === v) },
};
export async function storeWebMedia(file: File) {
  const spec = types[file.type];
  if (!spec || file.size < 1 || file.size > spec.max) throw new Error("Invalid media file");
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!spec.matches(bytes)) throw new Error("Invalid media file");
  const key = "web-media/" + randomUUID() + "." + spec.ext;
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (token) {
    const { put } = await import("@vercel/blob");
    const blob = await put(key, file, { access: "public", token, addRandomSuffix: false, contentType: file.type });
    return { storageKey: key, url: blob.url, type: file.type.startsWith("video/") ? "VIDEO" as const : "IMAGE" as const };
  }
  if (process.env.NODE_ENV === "production") throw new Error("Media storage is unavailable");
  const { mkdir, writeFile } = await import("node:fs/promises");
  const { join } = await import("node:path");
  await mkdir(join(process.cwd(), "public", "uploads", "web-media"), { recursive: true });
  await writeFile(join(process.cwd(), "public", "uploads", key), bytes);
  return { storageKey: key, url: "/uploads/" + key, type: file.type.startsWith("video/") ? "VIDEO" as const : "IMAGE" as const };
}
export async function removeWebMedia(key: string, url: string) {
  if (!/^web-media\/[a-f0-9-]+\.(jpg|png|webp|mp4|webm)$/.test(key)) return;
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (token && /^https:\/\/[^/]+\.public\.blob\.vercel-storage\.com\//.test(url)) {
    const { del } = await import("@vercel/blob"); await del(url, { token }); return;
  }
  if (url !== "/uploads/" + key) return;
  const { unlink } = await import("node:fs/promises");
  const { join } = await import("node:path");
  await unlink(join(process.cwd(), "public", "uploads", key)).catch((error: NodeJS.ErrnoException) => { if (error.code !== "ENOENT") throw error; });
}
