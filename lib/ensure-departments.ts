import type { PrismaClient } from "@prisma/client";

const STANDARD_DEPARTMENTS = [
  { id: "dept-gaming", name: "Gaming" },
  { id: "dept-computer-accessories", name: "Computer Accessories" },
  { id: "dept-mens-fashion", name: "Men's Fashion" },
  { id: "dept-womens-fashion", name: "Women's Fashion" },
  { id: "dept-womens-bags", name: "Women's Bags" },
] as const;

export async function ensureStandardDepartments(client: PrismaClient) {
  for (const department of STANDARD_DEPARTMENTS) {
    await client.department.upsert({
      where: { name: department.name },
      update: {},
      create: { id: department.id, name: department.name },
    });
  }
}
