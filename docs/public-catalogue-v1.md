# Public catalogue v1.2A

MATA3-SYSTEM owns catalogue publication, market prices, and purchase eligibility. MATA3-STORE reads only /api/public/v1.

## Contracts

GET /markets returns version 1 market codes, currencies, and supported locales. GET /categories?market=EGYPT|MOROCCO returns categories that have an active product with a published listing in that market. The category key is opaque and stable.

GET /products accepts market, page, pageSize, category key, and q. It returns one card per product with total and page metadata. GET /products/<slug>?market=... returns detail with all published market offers. Each offer has an opaque stable offerId, customer-facing attributes, exact {amountMinor,currency}, purchasable, and published WebProductMedia. Store retains this ID for exact selection.

GET /bundles and GET /bundles/<slug> expose active, published bundles. A bundle is omitted if any component lacks an active product and a published matching market offer. Its purchasable value checks every component and aggregates quantity per listing. Bundles have no independent inventory.

EGYPT prices use EGP and MOROCCO prices use MAD directly from each market listing. No FX conversion occurs. Unknown optional data is omitted.

## Publication and media

Only ACTIVE products and PUBLISHED listings appear. Bundle listings and WebProductMedia start as DRAFT, including migrated bundles. ProductImage remains staff-only and is never copied into WebProductMedia. Owner controls at /web-media upload IMAGE or VIDEO, attach to product, variant, or bundle, set cover and order, edit alt text, publish or hide, and remove. Published variant media takes precedence over product cover media and may include product supporting media.

Physical eligibility uses the effective inventory source and unreserved quantity. Nonphysical inventory types return purchasable false until Commerce OS defines a safe customer purchase rule. Public DTOs expose no stock quantity or source market.

## Migration and verification

The additive migration creates public offer/category keys and a partial unique index for product-only MarketListing rows where variantId is NULL. It aborts if duplicate rows already exist; resolve such rows manually without merging legitimate data. The local development database audit found zero duplicate groups. All six migrations, including this one, were applied to isolated local database mata3_catalogue_v12a_test. Existing production data was not migrated.

verify-public-catalogue.ts requires a fresh, migrated, isolated database named mata3_catalogue_v12a_test. verify-web-media.ts uses the same test data and a local System server on port 3101. Both refuse other database names. Store development fixtures are used only when no API base URL is configured outside production. Production requires MATA3_PUBLIC_API_BASE_URL and fails closed when absent.

Checkout, orders, tracking, customer accounts, customer authentication, and customer addresses remain outside v1.2A.


## v1.2B search and cart quote

GET /api/public/v1/search requires market=EGYPT|MOROCCO. Optional q, category, color, size, minPriceMinor, maxPriceMinor, page, pageSize (1–48), and sort (name_asc, price_asc, price_desc) are validated. The version 1 response contains public product cards and published public bundle representations, total/page metadata, supportedSorts, and facets for the filtered market/result set. Product matching uses public names, public descriptions, and public category name; bundle matching uses its customer-facing name. Sorting is by name or authoritative market price. There is no inferred relevance score. GET /api/public/v1/search/suggestions accepts market and q and returns actual product and category suggestions.

POST /api/public/v1/cart/quote accepts {market,lines:[{key,quantity,observedUnitAmountMinor?}]}. Keys are opaque public product offer or bundle offer IDs. The observed price is only a stale-state signal; System prices every valid line from current market listings. Response version 1 has currency, per-line canonical item data, unitPrice, lineTotal, stable codes, valid, itemsSubtotal, canProceed, and reservation:false. Prices are exact minor units in EGP or MAD. Invalid lines contribute zero to itemsSubtotal. canProceed requires every line valid and a nonempty cart. It indicates current eligibility to proceed toward a future checkout, not an order or reservation. Duplicate offers and bundle component demands aggregate across the full cart against effective physical inventory. The quote is a read-only repeatable-read transaction and neither changes inventory nor creates a sale.

Stable line codes: INVALID_KEY, INVALID_QUANTITY, WRONG_MARKET, NOT_PUBLIC, UNAVAILABLE, BUNDLE_UNAVAILABLE, INSUFFICIENT_STOCK, PRICE_CHANGED. Public failures return generic errors. Nonphysical listings remain ineligible until explicit source-specific customer purchase rules are defined. Search currently materializes published candidates before sorting and paginating; large catalogue performance should be reviewed before high-volume rollout.

For verification, reset only the local isolated mata3_catalogue_v12b_test database, apply the existing migrations, and run tsx scripts/verify-public-v12b.ts with DATABASE_URL set to that database. No v1.2B schema migration is required.


## v1.2C guest orders

GET /api/public/v1/checkout/config?market=EGYPT|MOROCCO returns version 1 currency, approved payment concepts, enabled delivery methods, and checkoutAvailable. MATA3_DELIVERY_CONFIG_JSON is the sole delivery configuration source. It is a JSON array of {market,code,label,amountMinor,enabled}; no delivery method or rate is supplied by default. Only configured enabled rows appear. MATA3_CONFIRMATION_SECRET must contain at least 32 random characters. No courier or payment gateway is integrated.

POST /api/public/v1/orders accepts market, opaque offer/bundle keys with quantities and optional previously observed unit amount, guest contact/address, configured delivery and payment codes, and a UUID idempotency key. The customer cannot supply price, fee, totals, status, payment status, or inventory source. A serializable transaction revalidates the public cart, aggregates effective source inventory, conditionally deducts stock, records inventory movements and allocation snapshots, then creates a frozen StorefrontOrder. Transaction failure rolls back all of these. Orders start RECEIVED and payment starts PENDING. Idempotent replay returns the same order and confirmation capability; changed input with the same key returns CONFLICT.

A random nonsequential MTA-EG or MTA-MA reference is unique. POST /api/public/v1/orders/confirm requires that reference plus a 15-minute HMAC capability. POST /api/public/v1/orders/track requires reference plus normalized market phone and returns a restricted frozen DTO. Unknown reference, wrong phone, and malformed pairs receive the same generic failure. Database-backed throttles limit client IP and reference attempts. Tracking shows only the actual current status and no synthetic timeline. availableCustomerActions is empty. The owner-only staff status endpoint records manual RECEIVED → PROCESSING → SHIPPED → DELIVERED changes, with CANCELLED allowed before shipment. Customer cancellation is not available.

The additive storefront_guest_order migration creates separate order, line, allocation, and tracking throttle tables. It does not change staff sales. Existing production data was not migrated during v1.2C implementation. The isolated local test database applied all migrations and ran verify-public-v12b.ts followed by verify-public-v12c.ts.
Owner-only /api/storefront-orders list and detail routes expose frozen orders for manual operations. The owner-only status route records permitted manual transitions; public tracking reads that actual status.
Owner cancellation before shipment atomically restores the frozen inventory allocations and records reversal movements. Repeated cancellation is rejected; payment status remains independent.
