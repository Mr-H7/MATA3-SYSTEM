-- Prisma manages @updatedAt in application writes; remove the temporary backfill default.
ALTER TABLE "ProductImage" ALTER COLUMN "updatedAt" DROP DEFAULT;
