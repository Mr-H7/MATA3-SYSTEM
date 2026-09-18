import { NextRequest, NextResponse } from "next/server";
import { Prisma, ShippingDestinationKind } from "@prisma/client";
import { requireOwner } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { currencyForShipping, providerFor, type ShippingMarket } from "@/lib/shipping";

const markets = ["EGYPT", "MOROCCO"] as const;
const validMarket = (value: unknown): value is ShippingMarket => value === "EGYPT" || value === "MOROCCO";
const code = (value: unknown) => typeof value === "string" && /^[A-Z0-9_]{2,40}$/.test(value);
const name = (value: unknown) => typeof value === "string" && value.trim().length >= 2 && value.length <= 100;
const error = (status: number, value = "INVALID_INPUT") => NextResponse.json({ code: value }, { status });
async function owner() { try { await requireOwner(); return true; } catch { return false; } }
export async function GET() {
  if (!await owner()) return error(403, "FORBIDDEN");
  try {
    const rows = await Promise.all(markets.map(async market => {
      const dbMarket = await prisma.market.findUnique({ where: { code: market }, include: { shippingConfiguration: true } });
      if (!dbMarket) return { market, provider: providerFor(market), currency: currencyForShipping(market), enabled: false, ready: false, destinations: [], methods: [], tariffs: [] };
      const [destinations, methods, tariffs] = await Promise.all([
        prisma.shippingDestination.findMany({ where: { marketId: dbMarket.id }, orderBy: [{ kind: "asc" }, { name: "asc" }] }),
        prisma.shippingMethod.findMany({ where: { marketId: dbMarket.id }, orderBy: { code: "asc" } }),
        prisma.shippingTariff.findMany({ where: { marketId: dbMarket.id }, orderBy: { effectiveFrom: "desc" } }),
      ]);
      const now = new Date();
      const byId = new Map(destinations.map(d => [d.id, d]));
      const pathFor = (destination: (typeof destinations)[number]) => {
        const path = [destination];
        let current = destination;
        for (let depth = 0; current.parentId && depth < 6; depth++) {
          const parent = byId.get(current.parentId);
          if (!parent || !parent.active || path.some(item => item.id === parent.id)) return [];
          path.unshift(parent); current = parent;
        }
        return current.parentId ? [] : path;
      };
      const ready = !!dbMarket.shippingConfiguration?.enabled && (process.env.MATA3_CONFIRMATION_SECRET?.length ?? 0) >= 32 &&
        destinations.some(destination => {
          if (!destination.active || destination.kind === "REGION") return false;
          const path = pathFor(destination);
          if (!path.length) return false;
          return methods.some(method => {
            if (!method.active || method.provider !== providerFor(market)) return false;
            const candidates = tariffs.map(tariff => {
              if (tariff.methodId !== method.id || !tariff.active || tariff.currency !== dbMarket.currency ||
                tariff.provenance !== "APPROVED_TARIFF" || tariff.packageClass || tariff.effectiveFrom > now ||
                (tariff.effectiveTo && tariff.effectiveTo <= now)) return -1;
              const index = tariff.destinationId ? path.findIndex(item => item.id === tariff.destinationId) : -1;
              return index >= 0 ? 100 + index : tariff.destinationGroupCode &&
                path.some(item => item.tariffGroupCode === tariff.destinationGroupCode) ? 1 : -1;
            }).filter(priority => priority >= 0).sort((a, b) => b - a);
            return candidates.length > 0 && candidates.filter(priority => priority === candidates[0]).length === 1;
          });
        });
      return { market, provider: providerFor(market), currency: dbMarket.currency,
        enabled: !!dbMarket.shippingConfiguration?.enabled, ready, connection: "MANUAL", pricing: "APPROVED_TARIFF",
        destinations, methods, tariffs };
    }));
    return NextResponse.json({ markets: rows }, { headers: { "Cache-Control": "no-store" } });
  } catch { return error(503, "SHIPPING_CONFIG_ERROR"); }
}
export async function POST(request: NextRequest) {
  if (!await owner()) return error(403, "FORBIDDEN");
  let body: unknown;
  try { body = await request.json(); } catch { return error(400); }
  if (!body || typeof body !== "object" || Array.isArray(body)) return error(400);
  const row = body as Record<string, unknown>;
  if (!validMarket(row.market)) return error(400);
  try {
    const market = await prisma.market.findUnique({ where: { code: row.market } });
    if (!market || market.currency !== currencyForShipping(row.market)) return error(400);
    if (row.type === "market") {
      if (typeof row.enabled !== "boolean") return error(400);
      await prisma.shippingMarketConfiguration.upsert({ where: { marketId: market.id },
        create: { marketId: market.id, enabled: row.enabled }, update: { enabled: row.enabled } });
    } else if (row.type === "destination") {
      if (!name(row.name) || !Object.values(ShippingDestinationKind).includes(row.kind as ShippingDestinationKind) ||
        (row.tariffGroupCode !== undefined && row.tariffGroupCode !== "" && !code(row.tariffGroupCode)) ||
        ["providerCityId", "providerZoneId", "providerDistrictId"].some(key => row[key] !== undefined && (typeof row[key] !== "string" || (row[key] as string).length > 100)))
        return error(400);
      const parent = row.parentKey ? await prisma.shippingDestination.findUnique({ where: { publicKey: String(row.parentKey) } }) : null;
      if (row.parentKey && (!parent || parent.marketId !== market.id || !parent.active)) return error(400);
      if ((row.kind === "REGION" && parent) || (row.kind === "CITY" && parent?.kind !== "REGION") ||
        (row.kind === "DISTRICT" && parent?.kind !== "CITY")) return error(400);
      await prisma.shippingDestination.create({ data: { marketId: market.id, kind: row.kind as ShippingDestinationKind,
        name: (row.name as string).trim(), parentId: parent?.id, active: false,
        tariffGroupCode: (row.tariffGroupCode as string) || null,
        providerCityId: (row.providerCityId as string) || null,
        providerZoneId: (row.providerZoneId as string) || null,
        providerDistrictId: (row.providerDistrictId as string) || null } });
    } else if (row.type === "method") {
      if (!code(row.code) || !name(row.label)) return error(400);
      await prisma.shippingMethod.create({ data: { marketId: market.id, provider: providerFor(row.market),
        code: row.code as string, label: (row.label as string).trim(), active: false } });
    } else if (row.type === "tariff") {
      if (!code(row.methodCode) || !Number.isSafeInteger(row.amountMinor) || (row.amountMinor as number) <= 0 ||
        typeof row.effectiveFrom !== "string" || !Number.isFinite(Date.parse(row.effectiveFrom)) ||
        (row.effectiveTo !== undefined && row.effectiveTo !== "" && (typeof row.effectiveTo !== "string" || !Number.isFinite(Date.parse(row.effectiveTo)))) ||
        (!!row.destinationKey === !!row.destinationGroupCode) ||
        (row.destinationGroupCode && !code(row.destinationGroupCode)) ||
        (row.packageClass !== undefined && row.packageClass !== "" && !code(row.packageClass))) return error(400);
      const method = await prisma.shippingMethod.findUnique({ where: { marketId_code: { marketId: market.id, code: row.methodCode as string } } });
      const destination = row.destinationKey ? await prisma.shippingDestination.findUnique({ where: { publicKey: String(row.destinationKey) } }) : null;
      if (!method || method.provider !== providerFor(row.market) || (row.destinationKey && (!destination || destination.marketId !== market.id)) ||
        (row.destinationGroupCode && !await prisma.shippingDestination.count({ where: { marketId: market.id, tariffGroupCode: String(row.destinationGroupCode) } }))) return error(400);
      const from = new Date(row.effectiveFrom), to = row.effectiveTo ? new Date(row.effectiveTo as string) : null;
      if (to && to <= from) return error(400);
      const scope = { marketId: market.id, methodId: method.id, destinationId: destination?.id ?? null,
        destinationGroupCode: (row.destinationGroupCode as string) || null, packageClass: (row.packageClass as string) || null };
      const overlapping = await prisma.shippingTariff.findFirst({ where: { ...scope, active: true,
        effectiveFrom: { lt: to ?? new Date("9999-12-31") },
        OR: [{ effectiveTo: null }, { effectiveTo: { gt: from } }] } });
      if (overlapping) return error(409, "TARIFF_OVERLAP");
      await prisma.shippingTariff.create({ data: { ...scope, amountMinor: row.amountMinor as number,
        currency: market.currency, provenance: "APPROVED_TARIFF", active: false, effectiveFrom: from, effectiveTo: to } });
    } else return error(400);
    return NextResponse.json({ ok: true }, { status: 201 });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return error(409, "DUPLICATE");
    return error(503, "SHIPPING_CONFIG_ERROR");
  }
}
export async function PATCH(request: NextRequest) {
  if (!await owner()) return error(403, "FORBIDDEN");
  let body: unknown;
  try { body = await request.json(); } catch { return error(400); }
  if (!body || typeof body !== "object" || Array.isArray(body)) return error(400);
  const row = body as Record<string, unknown>;
  if (!validMarket(row.market) || typeof row.id !== "string" || (row.active !== undefined && typeof row.active !== "boolean") || (row.active === undefined && !row.changes)) return error(400);
  try {
    const market = await prisma.market.findUnique({ where: { code: row.market } });
    if (!market) return error(400);
    if (row.type === "destination") {
      const found = await prisma.shippingDestination.findFirst({ where: { id: row.id, marketId: market.id } });
      if (!found) return error(404, "NOT_FOUND");
      if (row.active && found.parentId && !await prisma.shippingDestination.findFirst({ where: { id: found.parentId, active: true } })) return error(409, "PARENT_INACTIVE");
      const changes = row.changes && typeof row.changes === "object" && !Array.isArray(row.changes) ? row.changes as Record<string, unknown> : null;
      if (changes && (!name(changes.name) || ["providerCityId", "providerZoneId", "providerDistrictId"].some(key => changes[key] !== undefined && (typeof changes[key] !== "string" || (changes[key] as string).length > 100)) ||
        (changes.tariffGroupCode !== undefined && changes.tariffGroupCode !== "" && !code(changes.tariffGroupCode)))) return error(400);
      await prisma.shippingDestination.update({ where: { id: found.id }, data: {
        ...(row.active !== undefined ? { active: row.active as boolean } : {}),
        ...(changes ? { name: (changes.name as string).trim(), tariffGroupCode: (changes.tariffGroupCode as string) || null,
          providerCityId: (changes.providerCityId as string) || null, providerZoneId: (changes.providerZoneId as string) || null,
          providerDistrictId: (changes.providerDistrictId as string) || null } : {}),
      } });
    } else if (row.type === "method") {
      const found = await prisma.shippingMethod.findFirst({ where: { id: row.id, marketId: market.id } });
      if (!found) return error(404, "NOT_FOUND");
      if (row.changes && (!row.changes || typeof row.changes !== "object" || Array.isArray(row.changes) || !name((row.changes as Record<string, unknown>).label))) return error(400);
      await prisma.shippingMethod.update({ where: { id: found.id }, data: {
        ...(row.active !== undefined ? { active: row.active as boolean } : {}),
        ...(row.changes ? { label: ((row.changes as Record<string, unknown>).label as string).trim() } : {}),
      } });
    } else if (row.type === "tariff") {
      const found = await prisma.shippingTariff.findFirst({ where: { id: row.id, marketId: market.id } });
      if (!found) return error(404, "NOT_FOUND");
      if (row.active) {
        const overlapping = await prisma.shippingTariff.findFirst({ where: { id: { not: found.id }, marketId: market.id,
          methodId: found.methodId, destinationId: found.destinationId, destinationGroupCode: found.destinationGroupCode,
          packageClass: found.packageClass, active: true,
          effectiveFrom: { lt: found.effectiveTo ?? new Date("9999-12-31") },
          OR: [{ effectiveTo: null }, { effectiveTo: { gt: found.effectiveFrom } }] } });
        if (overlapping) return error(409, "TARIFF_OVERLAP");
      }
      await prisma.shippingTariff.update({ where: { id: found.id }, data: { active: row.active } });
    } else return error(400);
    return NextResponse.json({ ok: true });
  } catch { return error(503, "SHIPPING_CONFIG_ERROR"); }
}
