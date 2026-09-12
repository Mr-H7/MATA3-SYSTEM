"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export default function Login() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      const response = await fetch("/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username, password }) });
      if (response.ok) { router.replace("/"); router.refresh(); return; }
      const result = await response.json() as { error?: string }; setError(result.error || "Sign in failed.");
    } catch { setError("Unable to reach MATA3. Please try again."); }
    finally { setBusy(false); }
  }
  return <main className="login-page">
    <section className="login-brand">
      <div className="login-mark">م</div>
      <div><div className="text-2xl font-extrabold tracking-[.16em]">MATA3 <span className="text-[#c6a227]">| مَتاع</span></div><div className="mt-1 text-xs uppercase tracking-[.2em] text-[#9f9a91]">Commerce Operating System</div></div>
      <div className="mt-auto max-w-md"><p className="text-3xl font-semibold leading-tight">The modern Arab merchant.<br /><span className="text-[#c6a227]">Ink × Metal × Paper.</span></p><p className="mt-4 text-sm text-[#aaa49a]">Secure internal access for MATA3 commerce operations in Egypt and Morocco.</p></div>
    </section>
    <section className="grid place-items-center p-6"><form onSubmit={submit} className="card w-full max-w-md p-7 md:p-9"><div className="eyebrow">Secure access</div><h1 className="page-title mt-2">Sign in</h1><p className="page-subtitle">Use your assigned MATA3 account.</p><label className="mt-7 block text-xs font-semibold text-[#6e685e]">Username<input autoFocus autoComplete="username" required className="form-control mt-1" value={username} onChange={(event) => setUsername(event.target.value)} /></label><label className="mt-4 block text-xs font-semibold text-[#6e685e]">Password<input type="password" autoComplete="current-password" required className="form-control mt-1" value={password} onChange={(event) => setPassword(event.target.value)} /></label>{error ? <p className="mt-4 rounded bg-[#fdf0ed] p-3 text-sm text-[#c0392b]" role="alert">{error}</p> : null}<button disabled={busy} className="btn btn-gold mt-6 w-full !min-h-11">{busy ? "Signing in…" : "Sign in to MATA3"}</button><p className="mt-5 text-center text-[11px] text-[#8c7356]">Authorized staff only · Server-enforced permissions</p></form></section>
  </main>;
}
