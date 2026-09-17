"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import type { SessionUser } from "@/lib/auth";
import LogoutButton from "../logout-button";

type NavItem = { label: string; href: string; icon: string };
type NavGroup = { label: string; items: NavItem[] };

const ownerNavigation: NavGroup[] = [
  { label: "Overview", items: [{ label: "Dashboard", href: "/", icon: "▦" }] },
  { label: "Commerce", items: [{ label: "Sales", href: "/sales", icon: "▤" }, { label: "New Sale", href: "/sales/new", icon: "+" }, { label: "Returns", href: "/returns", icon: "↩" }, { label: "Customers", href: "/customers", icon: "♙" }] },
  { label: "Catalogue", items: [{ label: "Products", href: "/catalogue", icon: "◇" }, { label: "Web Products", href: "/web-products", icon: "◈" }, { label: "Web Media", href: "/web-media", icon: "▧" }, { label: "Inventory", href: "/inventory", icon: "▣" }, { label: "Bundles", href: "/bundles", icon: "▱" }, { label: "Categories", href: "/categories", icon: "⌑" }] },
  { label: "Management", items: [{ label: "Suppliers", href: "/suppliers", icon: "▥" }, { label: "Markets", href: "/markets", icon: "◎" }, { label: "Targets", href: "/targets", icon: "↗" }, { label: "Users / Staff", href: "/users", icon: "♚" }] },
  { label: "Intelligence", items: [{ label: "Reports", href: "/reports", icon: "▥" }, { label: "Shift Close", href: "/shift-close", icon: "◷" }, { label: "Export", href: "/export", icon: "⇧" }] },
  { label: "System", items: [{ label: "Settings", href: "/settings", icon: "⚙" }] },
];

const sellerNavigation: NavGroup[] = [
  { label: "Overview", items: [{ label: "Dashboard", href: "/", icon: "▦" }] },
  { label: "Sales", items: [{ label: "New Sale", href: "/sales/new", icon: "+" }, { label: "Sales / Invoices", href: "/sales", icon: "▤" }] },
  { label: "Catalogue", items: [{ label: "Products", href: "/catalogue", icon: "◇" }] },
  { label: "Performance", items: [{ label: "My Target", href: "/targets", icon: "↗" }] },
  { label: "Operations", items: [{ label: "Customers", href: "/customers", icon: "♙" }, { label: "Shift Close", href: "/shift-close", icon: "◷" }] },
];

const routeNames: Record<string, string> = {
  "/": "Dashboard", "/catalogue": "Products", "/inventory": "Inventory", "/sales": "Sales / Invoices",
  "/returns": "Returns", "/customers": "Customers", "/bundles": "Bundles", "/categories": "Categories", "/web-products": "Web Products", "/web-media": "Web Media",
  "/suppliers": "Suppliers", "/markets": "Markets", "/targets": "Targets", "/users": "Users / Staff",
  "/reports": "Reports", "/shift-close": "Shift Close", "/export": "Export", "/settings": "Settings",
};

function pageName(pathname: string) {
  if (pathname === "/sales/new") return "New Sale";
  if (pathname === "/catalogue/new") return "Add Product";
  const root = `/${pathname.split("/").filter(Boolean)[0] || ""}`;
  const suffix = pathname.endsWith("/edit") ? " · Edit" : "";
  return `${routeNames[root] || "MATA3"}${suffix}`;
}

export default function AppShell({ user, children }: { user: SessionUser | null; children: React.ReactNode }) {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  if (!user || pathname === "/login") return children;
  const seller = user.role === "SELLER";
  const navigation = seller
    ? sellerNavigation
    : user.role === "OWNER"
      ? ownerNavigation
      : ownerNavigation.map((group) => ({
          ...group,
          items: group.items.filter((item) => item.href !== "/web-products" && item.href !== "/web-media"),
        }));
  const marketLabel = user.marketScope === "ALL" ? "All Markets · EGP / MAD" : user.marketScope === "EGYPT" ? "Egypt · EGP" : "Morocco · MAD";
  const isActive = (href: string) => {
    if (href === "/") return pathname === "/";
    if (pathname === "/sales/new") return href === "/sales/new";
    return pathname === href || pathname.startsWith(`${href}/`);
  };
  return (
    <div className="app-shell">
      {menuOpen ? <button className="sidebar-scrim" aria-label="Close navigation" onClick={() => setMenuOpen(false)} /> : null}
      <aside className={`app-sidebar${menuOpen ? " open" : ""}`}>
        <div className="brand-block">
          <div className="brand-mark" aria-hidden="true">م</div>
          <div><div className="brand-name">MATA3 <span className="brand-ar">| مَتاع</span></div><div className="brand-sub">Commerce OS</div></div>
        </div>
        <nav className="app-nav" aria-label="Main navigation">
          {navigation.map((group) => <section className="nav-group" key={group.label}>
            <div className="nav-label">{group.label}</div>
            {group.items.map((item) => <Link key={item.href} href={item.href} className={`nav-link${isActive(item.href) ? " active" : ""}`} onClick={() => setMenuOpen(false)}>
              <span className="nav-icon" aria-hidden="true">{item.icon}</span><span>{item.label}</span>
            </Link>)}
          </section>)}
        </nav>
        <div className="sidebar-account">
          <div className="account-row">
            <div className="avatar">{user.name.slice(0, 1).toUpperCase()}</div>
            <div className="min-w-0 flex-1"><div className="truncate font-semibold">{user.name}</div><div className="account-meta"><span className="role-badge">{user.role}</span> · {user.marketScope}</div></div>
          </div>
          <LogoutButton />
        </div>
      </aside>
      <div className="app-frame">
        <header className="app-header">
          <div className="flex items-center gap-3">
            <button className="mobile-menu" aria-label="Open navigation" onClick={() => setMenuOpen(true)}>☰</button>
            <div><div className="header-kicker">MATA3 / Operations</div><div className="header-title">{pageName(pathname)}</div></div>
          </div>
          <div className="header-actions">
            <div className="market-context"><span className="market-dot" /><span>{marketLabel}</span></div>
            {pathname !== "/sales/new" ? <Link className="btn btn-gold" href="/sales/new"><span aria-hidden="true">＋</span> New Sale</Link> : null}
          </div>
        </header>
        <div className="app-content">{children}</div>
      </div>
    </div>
  );
}
