import { MarketScope, PrismaClient, Role } from "@prisma/client";
import { hashPassword } from "../lib/password";

const prisma = new PrismaClient();

function requiredSecret(name: "SEED_OWNER_PASSWORD" | "SEED_SELLER_PASSWORD") {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required for production bootstrap`);
  return value;
}

async function ensureUser(input: {
  email: string;
  username: string;
  name: string;
  password: string;
  role: Role;
  marketScope: MarketScope;
}) {
  const existing = await prisma.user.findUnique({ where: { email: input.email } });
  if (existing) return;

  await prisma.user.create({
    data: {
      email: input.email,
      username: input.username,
      name: input.name,
      passwordHash: await hashPassword(input.password),
      role: input.role,
      marketScope: input.marketScope,
      active: true,
    },
  });
}

async function main() {
  await prisma.market.upsert({
    where: { code: "EGYPT" },
    update: { name: "Egypt", currency: "EGP", timezone: "Africa/Cairo" },
    create: { code: "EGYPT", name: "Egypt", currency: "EGP", timezone: "Africa/Cairo" },
  });
  await prisma.market.upsert({
    where: { code: "MOROCCO" },
    update: { name: "Morocco", currency: "MAD", timezone: "Africa/Casablanca" },
    create: { code: "MOROCCO", name: "Morocco", currency: "MAD", timezone: "Africa/Casablanca" },
  });

  await ensureUser({
    email: "owner@mata3.local",
    username: "Haytham",
    name: "Haytham",
    password: requiredSecret("SEED_OWNER_PASSWORD"),
    role: Role.OWNER,
    marketScope: MarketScope.ALL,
  });
  await ensureUser({
    email: "poha@mata3.local",
    username: "poha",
    name: "Mostapha",
    password: requiredSecret("SEED_SELLER_PASSWORD"),
    role: Role.SELLER,
    marketScope: MarketScope.MOROCCO,
  });

  console.log("Production bootstrap complete: markets and required accounts are present.");
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : "Production bootstrap failed");
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
