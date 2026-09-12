UPDATE "SaleItem" AS item
SET "marketCode" = market."code",
    "currency" = market."currency"
FROM "Sale" AS sale
JOIN "Market" AS market ON market."id" = sale."marketId"
WHERE item."saleId" = sale."id"
  AND (item."marketCode" = '' OR item."currency" = '');
