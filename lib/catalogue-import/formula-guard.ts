export function csvSafe(value: string | number) {
  const text = String(value ?? "");
  const escaped = text.replaceAll('"', '""');
  const guarded = /^[=+\-@|]/.test(escaped) ? `'${escaped}` : escaped;
  return `"${guarded}"`;
}

export function sheetSafe(value: string | number) {
  const text = String(value ?? "");
  return /^[=+\-@|]/.test(text) ? `'${text}` : text;
}
