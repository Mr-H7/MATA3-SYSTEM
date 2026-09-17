import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
export default async function WebMediaLayout({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (user.role !== "OWNER") redirect("/");
  return children;
}
