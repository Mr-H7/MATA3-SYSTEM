import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
export function middleware(req: NextRequest) {
  if (req.nextUrl.pathname === "/login" || req.nextUrl.pathname.startsWith("/api/auth") || req.nextUrl.pathname.startsWith("/api/public/")) {
    return NextResponse.next();
  }
  if (!req.cookies.get("mata3_session")) return NextResponse.redirect(new URL("/login", req.url));
  return NextResponse.next();
}
export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };
