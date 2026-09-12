import type { Metadata } from "next";
import { getSessionUser } from "@/lib/auth";
import AppShell from "./ui/app-shell";
import "./globals.css";

export const metadata: Metadata = {
  title: "MATA3 Commerce OS",
  description: "MATA3 internal commerce operations",
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const user = await getSessionUser();
  return (
    <html lang="en">
      <body>
        <AppShell user={user}>{children}</AppShell>
      </body>
    </html>
  );
}
