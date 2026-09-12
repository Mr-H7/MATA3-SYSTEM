import { NextResponse } from "next/server";
import { COOKIE_NAME, getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
export async function POST() { const user = await getSessionUser(); if (user) await prisma.auditLog.create({ data: { userId: user.id, action: "LOGOUT", entity: "User", entityId: user.id } }); const response = NextResponse.json({ ok: true }); response.cookies.set(COOKIE_NAME, "", { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 0 }); return response; }
