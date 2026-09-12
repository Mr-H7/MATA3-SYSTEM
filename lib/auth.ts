import { createHmac, timingSafeEqual } from "node:crypto";
import { MarketScope, Role } from "@prisma/client";
import { cookies } from "next/headers";
import { prisma } from "./prisma";

export const COOKIE_NAME = "mata3_session";
const SESSION_MAX_AGE = 60 * 60 * 12;
const secret = () => process.env.SESSION_SECRET || (process.env.NODE_ENV === "production" ? "" : "mata3-development-session-secret-change-me");
const signature = (id: string) => createHmac("sha256", secret()).update(id).digest("hex");
export type SessionUser = { id: string; username: string | null; name: string; role: Role; marketScope: MarketScope; active: boolean };
export function createSessionValue(id: string) { if (!secret()) throw new Error("SESSION_SECRET is required"); return `${id}.${signature(id)}`; }
export function sessionCookieOptions() { return { httpOnly: true, sameSite: "lax" as const, secure: process.env.NODE_ENV === "production", path: "/", maxAge: SESSION_MAX_AGE }; }
export async function getSessionUser(): Promise<SessionUser | null> { const value = (await cookies()).get(COOKIE_NAME)?.value; if (!value) return null; const separator = value.lastIndexOf("."); if (separator < 1) return null; const id = value.slice(0, separator), supplied = value.slice(separator + 1), expected = signature(id); if (supplied.length !== expected.length || !timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))) return null; return prisma.user.findFirst({ where: { id, active: true }, select: { id: true, username: true, name: true, role: true, marketScope: true, active: true } }); }
export async function requireUser() { const user = await getSessionUser(); if (!user) throw new Error("UNAUTHENTICATED"); return user; }
export async function requireOwner() { const user = await requireUser(); if (user.role !== Role.OWNER) throw new Error("FORBIDDEN"); return user; }
export function canManageGlobalData(role: Role) { return role === Role.OWNER || role === Role.ADMIN; }
export function canAccessMarket(userOrRole: SessionUser | Role, marketCode: string) { const role = typeof userOrRole === "string" ? userOrRole : userOrRole.role; if (role === Role.OWNER || role === Role.ADMIN) return true; if (role === Role.EGYPT_MANAGER) return marketCode === "EGYPT"; if (role === Role.MOROCCO_MANAGER) return marketCode === "MOROCCO"; if (typeof userOrRole === "string") return false; return userOrRole.marketScope === MarketScope.ALL || userOrRole.marketScope === marketCode; }
export async function requireMarketAccess(marketCode: string) { const user = await requireUser(); if (!canAccessMarket(user, marketCode)) throw new Error("FORBIDDEN"); return user; }
export function isSeller(user: SessionUser) { return user.role === Role.SELLER; }
