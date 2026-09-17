export function normalizeGuestPhone(market: "EGYPT" | "MOROCCO", input: string): string | null {
  const digits = input.replace(/[()\s-]/g, "");
  if (market === "EGYPT") {
    if (/^01[0125]\d{8}$/.test(digits)) return "+20" + digits.slice(1);
    if (/^\+201[0125]\d{8}$/.test(digits)) return digits;
  } else {
    if (/^0[67]\d{8}$/.test(digits)) return "+212" + digits.slice(1);
    if (/^\+212[67]\d{8}$/.test(digits)) return digits;
  }
  return null;
}
