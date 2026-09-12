"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export default function LogoutButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return <button className="mt-3 block w-full rounded border border-[#33312b] px-3 py-2 text-left text-xs text-[#b9b4aa] hover:bg-[#292824] hover:text-white" disabled={busy} onClick={async () => {
    setBusy(true);
    await fetch("/api/auth/logout", { method: "POST" });
    router.replace("/login");
    router.refresh();
  }}>{busy ? "Signing out…" : "Sign out"}</button>;
}
