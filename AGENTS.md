# AGENTS.md

This is the canonical repo guide for humans and coding agents. Keep repository-specific architecture, workflows, conventions, and integration pitfalls here, and keep `.github/copilot-instructions.md` short and Copilot-specific.

## Repo map
- This repo has two coupled parts: `crawler/` scrapes AutoScout24 into PostgreSQL, and `frontend/` reads the same DB directly to render charts/tables.
- The main cross-component contract is the PostgreSQL schema in `crawler/SCHEMA.sql` plus the `searches`, `search_runs` tables and `search_id`/`search_run_id` semantics used by both `crawler/autoscout/pipelines.py` and `frontend/src/lib/data.js`.
- Generated artifacts live in `crawler/output/` (screenshots). Treat that directory as runtime output, not source.

## Fast paths
- Crawler entrypoint: `crawler/autoscout/spiders/search.py`
- DB writes: `crawler/autoscout/pipelines.py`
- Batch summary email: `crawler/autoscout/email.py`
- Search run tracking: `crawler/autoscout/extensions.py`
- Frontend DB queries: `frontend/src/lib/data.js`
- Frontend Server Actions (search CRUD, run/screenshot deletion): `frontend/src/lib/actions.js`
- Frontend R2 client (object deletion): `frontend/src/lib/r2.js`
- Main UI route: `frontend/src/app/search/[searchName]/page.js`
- Settings page: `frontend/src/app/settings/page.js`
- Search management UI: `frontend/src/components/search-manager.js`
- Client-side settings (localStorage): `frontend/src/components/client-settings.js`
- Search tab navigation (active / previous): `frontend/src/components/search-tabs.js`
- Search selector dropdown (navbar): `frontend/src/components/search-dropdown.js`
- Cars table (sorting, column visibility, seller cell): `frontend/src/components/cars.js`
- Lightbox image viewer: `frontend/src/components/lightbox.js`
- Google Places integration: `frontend/src/components/place-details.js`
- Screenshot storage chart + cleanup UI: `frontend/src/components/screenshot-storage.js`
- Search runs client component: `frontend/src/components/search-runs.js`
- Number/date formatting: `frontend/src/lib/format.js`
- Formatter React Context: `frontend/src/lib/formatter-context.js`

## Developer workflows
- Frontend commands are the standard ones from `frontend/package.json`: `pnpm dev`, `pnpm build`, `pnpm lint`.
- The crawler is usually run from `crawler/` with `scrapy crawl search -a search_id=<id>`.
- `crawler/run-spiders.sh` is the operational path for batch runs: it runs `uv sync` (creating `.venv` if missing) then crawls every active search from the `searches` database table. Requires `uv` installed on the host.
- Crawler settings load env vars automatically via `load_dotenv()` in `crawler/autoscout/settings.py`, so `.env` is expected in `crawler/`.

## Crawler architecture and patterns
- `SearchSpider` loads a search config from the `searches` database table by `search_id`. It connects to the DB at init time to fetch the search `name` and `url`.
- Search result pages yield `CarPageRequest`s; car detail pages are parsed from Next.js flight data via `njsparser`, not from visible HTML. Keep `_extract_flight_data()` in `search.py` in sync with site structure changes.
- `crawler/autoscout/flight_data_patch.py` makes njsparser decode flight data rows with an empty value to `None` instead of raising, and `search.py` applies it at import. AutoScout24 streams part of its RSC payload, which emits valueless React rows such as `a:X` (start async iterable) and `a:C` (stop stream); njsparser 2.16 passes their empty payload to `orjson.loads`, which raises `JSONDecodeError: Input is a zero-length, empty document` and aborts the entire page parse. Drop the patch once njsparser handles those row classes itself — they are listed as unimplemented in its own TODO in `njsparser/parser/flight_data.py`, and 2.16 is still the latest release as of August 2026.
- The spider yields `SellerItem` before `CarItem`; the pipeline processes them in that order.
- `PostgreSQLPipeline` buffers sellers and cars separately, inserts sellers with `ON CONFLICT DO NOTHING`, then inserts cars with a shared `search_run_id` created by `SearchRunExtension`.
- `SearchRunExtension` (EXTENSIONS priority 500) creates a `search_runs` row on `spider_opened` and updates it with final stats on `spider_closed`. It publishes `search_run_id` to Scrapy stats so `PostgreSQLPipeline` can read it.
- Failed requests are retried up to `RETRY_TIMES` (3) by Scrapy's built-in `RetryMiddleware`. The middleware intercepts retryable HTTP status codes and connection errors before they reach the spider. Only permanently failed requests (all retries exhausted) reach the spider's `handle_error` errback and are recorded in `self.failed_requests`.
- Parsing failures are recorded in `self.failed_requests` too: `parse()` records the search page URL and re-raises (so Scrapy also counts it in `spider_exceptions`), while `parse_car()` records the car URL and continues with the remaining cars. A page that downloads fine but cannot be parsed must never be silently dropped.
- Record `_requested_url(response)`, not `response.url`, in `failed_requests`. The CDP middleware builds responses with `url=window.location.href`, so `response.url` is wherever the browser ended up: AutoScout24 strips `pagination[page]=0`, which would drop the page number from the failure record and disagree with `handle_error`, which uses `failure.request.url`.
- A run counts as successful only when `cars_found == cars_scraped` **and** there are no failed requests **and** `spider_exceptions/count` is zero. `SearchRunExtension` writes that verdict to `search_runs.success` and publishes it to Scrapy stats as `run_success`. `run-spiders.py` reads `run_success` from every crawler and exits non-zero if any search did not succeed, so `run-spiders.sh` (`set -eu`) fails the cron job. A search that legitimately matches zero cars still counts as successful.
- `ScreenshotPipeline` (priority 250) compresses screenshots from raw PNG to WebP lossy, deduplicates via MD5 hash, uploads to Cloudflare R2 with UUID-based keys (`screenshots/{uuid}.webp`), and stores metadata in the `screenshots` table. It sets `car['screenshot_id']` for `PostgreSQLPipeline` to insert. Requires R2 env vars (`R2_ENDPOINT_URL`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME`, `R2_PUBLIC_URL`); gracefully skips if not configured.
- `PhotoPipeline` (priority 260) resolves all seller-uploaded listing photos from `listing-images.autoscout24.ch/{key}` (the `key` returned by the API already carries its own `listing/` prefix) to rows in the `photos` table. It sets `item.photo_refs` — a list of `(position, photo_id)` pairs — for `PostgreSQLPipeline` to insert into the `car_photos` junction table. Requires the same R2 env vars as `ScreenshotPipeline`; gracefully skips if not configured.
- `PhotoPipeline` works in phases, and which thread each phase runs on is the load-bearing part. Every DB call runs on the reactor thread; only pure network/CPU functions go to the executor, so the connection shared via `crawler.db_connection` is never touched from two threads. Phases: (1) look up all of the car's image keys in `photo_sources` — a hit costs no network at all; (2) download, WebP-encode and MD5 the remaining keys in worker threads, one task per photo, so the encode never runs serially on the reactor; (3) collapse duplicate MD5s within the car, then match the rest against `photos` in one batched `= ANY(...)` query; (4) `put_object` the genuinely new ones in parallel, outside any DB transaction; (5) one transaction inserting the `photos` rows and the `photo_sources` mappings. A fully cached car costs one query and no network; an all-new car costs four queries instead of two per photo.
- The MD5 in `photos.md5_hash` is of the *compressed* WebP, so it can only be computed after downloading and re-encoding. `photo_sources` is what makes a re-crawl cheap: it maps AutoScout24's own `image_key` to a `photos.id` before any network happens. Many keys may map to one photo (MD5 dedup across listings), which is why it is a table and not a column on `photos`. The mapping trusts that a key's bytes never change — there is deliberately no ETag revalidation, since a conditional GET would cost a round trip per photo on every run.
- Use `= ANY(%s::bpchar[])` when matching `photos.md5_hash` in bulk. The column is `character(32)`; a `text[]` risks the planner declining `photos_md5_hash_key` and sequentially scanning `photos` once per car.
- The photo executor and the boto3 client are both built in `PhotoPipeline.open_spider`, not lazily. botocore clients are only thread-safe when constructed before the threads that share them. `PHOTO_WORKERS` (settings.py, default 8) sizes both the executor and the `requests` connection pool.
- A photo failure must never cost a car. `_process_photos` catches everything, logs, increments `photos/car_failed` and returns no photos, so the `CarItem` still reaches `PostgreSQLPipeline` with its price and mileage. Per-photo stats (`photos/key_hit`, `photos/md5_hit`, `photos/downloaded`, `photos/uploaded`, `photos/failed`) land in `search_runs.stats` automatically.
- `PostgreSQLPipeline` (priority 300) inserts cars and then creates `car_photos` junction rows linking each car to its photos with position ordering. `position` is the index into the listing's `image_keys`, carried through `item.photo_refs` — never `enumerate()` over the stored photos, or one failed download silently promotes every later photo and the listing loses its lead image. A failed download leaves a gap in the sequence; `fetchCarPhotos` orders by `position` and assumes nothing about contiguity.
- Failed URLs (with reason) are stored in Scrapy stats via `self.crawler.stats.set_value('failed_urls', self.failed_requests)` in the spider's `closed()` method. This list is automatically persisted in the `search_runs.stats` JSONB column by `SearchRunExtension`.
- `run-spiders.py` configures daily-rotating file logging in `$XDG_STATE_HOME/autoscout24-trends/` (default `~/.local/state/autoscout24-trends/`). Log files are named `crawl.log` with 30-day retention. Console logging is kept as-is. The cron job no longer needs shell-level output redirection.
- If you add/remove car fields, update all of these together: `crawler/autoscout/items.py`, `crawler/autoscout/pipelines.py`, `crawler/SCHEMA.sql`, and any frontend queries/components that read the field.
- A batch summary email is sent after all spiders finish in `run-spiders.py`. The email logic lives in `crawler/autoscout/email.py` and uses the Resend SDK. It queries the `search_runs` table for stats. The recipient address is read from the `config` database table (key `email-recipient`, set in the frontend Settings page). Configure `RESEND_API_KEY` in `.env` to enable it.
- The `cars` table uses `search_id` (FK to `searches.id`) and `search_run_id` (FK to `search_runs.id`). `search_id` is kept for query convenience. Renaming a search in the `searches` table automatically propagates to all historical car data.

## Frontend architecture and patterns
- The frontend uses App Router server components for data fetching and passes unresolved promises into client components, which call `use(data)` (`cars.js`, `daily-listing-count.js`, `mileage-price-comparison.js`). Preserve that pattern when adding new visualizations.
- `frontend/src/lib/data.js` owns all SQL reads. `frontend/src/lib/actions.js` owns all SQL writes (Server Actions for search CRUD, run/screenshot deletion). Prefer extending queries in these files instead of embedding SQL in pages/components.
- Route params are URL-encoded search names. `navbar.js` uses `SearchDropdown` (which calls `fetchSearchNames()`) and `search/[searchName]/page.js` decodes the param before querying.
- The search page uses a `?tab=active|previous` URL param to switch between active and previous listings; `SearchTabs` renders the tab nav and the page conditionally fetches data for the active tab only.
- "Active listings" means rows from the latest `search_run_id` for a given search; "Previous listings" means the most recent older row per `vehicle_id` that is absent from the latest run.
- All car queries join through the `searches` table via `cars.search_id` and filter by `searches.name`.
- The daily chart aggregates by `date_in`, not by listing creation time.
- Styling uses Tailwind utility classes with local UI primitives under `frontend/src/components/ui/`; avoid introducing a second styling system.
- UI primitives (`button`, `card`, `chart`, `dropdown-menu`, `popover`, `table`, `tooltip`) wrap `@base-ui/react` and shadcn-generated foundations.

## Cars table (`cars.js`)
- Column definitions live in the `COLUMNS` array at the top of the file. Add new columns there (key, label, sortType, sortKey, align, defaultVisible).
- Sorting: click column headers to toggle asc/desc. Sort comparison is type-aware (numeric, text, date). Default sort is price ascending.
- Column visibility: stored in localStorage (`'car-table-visible-columns'`), synced across tables via a custom `'visible-columns-changed'` event (since `storage` events only fire in other tabs). Uses `useSyncExternalStore` with a server snapshot of default columns to avoid hydration mismatches.
- Screenshot/photo viewing: clicking the camera icon opens a `Lightbox` component (fullscreen overlay with left/right navigation, keyboard support, Escape to close). The lightbox is rendered via `createPortal` at the document root. Click the image to toggle between fit-by-height and fit-by-width modes; the container scrolls when the image exceeds the viewport. When opened, the lightbox lazy-loads additional listing photos via `fetchMoreUrl`.
- Seller cell: shows seller name (truncated), location, and three icons — Google Maps link (MapPinIcon), directions from home (NavigationIcon, requires home address in Settings), and place details popover (MapIcon, requires Google Maps API key, disabled for private sellers).
- Text truncation: title (70 chars), description (70 chars, scrollable tooltip), seller name (30 chars). All use `TruncatedText` component with `Tooltip`. `TruncatedText` accepts an optional `href` prop to render the text as a link (used for car title).

## Search runs page (`/search-runs`)
- Server-side paginated with URL query params: `page`, `search`, `pageSize`, `from`, `to`.
- Default page size is 20 (options: 10, 20, 50, 100). Default date range is last 7 days.
- `fetchSearchRuns(searchName, page, pageSize, fromDate, toDate)` in `data.js` uses `LIMIT`/`OFFSET` with date filtering on `sr.started_at`; `fetchSearchRunsCount(searchName, fromDate, toDate)` returns the total.
- The `SearchRuns` client component (`search-runs.js`) manages all controls and navigation: refresh button, search filter dropdown, page size dropdown, date range inputs (native `<input type="date">`), pagination, and a delete-run button with confirmation dialog.
- Navigation uses `window.location.href` so the URL changes are reflected in the server component.
- Preferences (search filter, page size, date range) are persisted to localStorage (`'search-runs-preferences'`) and restored on the next bare visit (no explicit URL params).
- The "Stats" column shows a popover with the `search_runs.stats` JSONB data (formatted JSON in a `<pre>` block).
- Deleting a search run (`deleteSearchRun` action) also deletes its cars, orphaned screenshots from the DB and R2, and the `search_runs` row itself inside a transaction.

## Settings page (`/settings`)
- The settings page is a server component that fetches searches from the database and renders three sections:
  - **SearchManager** (`search-manager.js`): CRUD for search configurations (name, URL, active toggle, per-search `screenshots_enabled` / `photos_enabled` toggles, copy URL button). Uses Server Actions from `actions.js`.
  - **ClientSettings** (`client-settings.js`): Google Maps API key, home address, and email recipient. Settings are stored in the database `config` table via the `updateConfig` server action.
  - **ScreenshotStorage** (`screenshot-storage.js`): Bar chart of daily screenshot storage usage and a cleanup form to delete screenshots older than a configurable retention period (30/90/180 days). Uses `deleteOldScreenshots` server action.
- Maps API key is consumed by `place-details.js` via `useSyncExternalStore` in `cars.js`.
- Home address is consumed by the directions link in `SellerCell` via `useSyncExternalStore`.
- Does not dispatch custom events itself; components that depend on these values read them from localStorage (e.g. via `useSyncExternalStore`) for same-tab sync.

## Google Places integration (`place-details.js`)
- Uses `@googlemaps/js-api-loader` v2 functional API: `setOptions()` + `importLibrary('places')`.
- Uses the new `Place` class (`Place.searchByText()` + `place.fetchFields()`), NOT the deprecated `PlacesService`.
- Module-level cache (`placeCache` Map) keyed by `"sellerName|zipCode|city"` avoids redundant API calls.
- Requires **Maps JavaScript API** and **Places API (New)** enabled in Google Cloud Console.

## Locale formatting (`format.js` + `formatter-context.js`)
- The root layout reads the `Accept-Language` HTTP header via `parseAcceptLanguage()` and wraps the app in `<FormatterProvider locale={…}>`.
- `FormatterProvider` (client component) calls `createFormatters(locale)` once and exposes the result via React Context.
- All client components — tables and charts alike — call `useFormatter()` to get `{ asDecimal, asShortDate, asMediumDate, asShortMonthYearDate, asShortDayMonthDate, asTime }`. No locale prop-drilling, no module-level formatter singletons.
- `asShortDayMonthDate` formats a timestamp as short month + day (no year), e.g. "Jun 27" — used in date-axis charts.
- Because the same locale is used for SSR and client rendering, there are no hydration mismatches.

## Project-specific conventions
- Frontend formatting is intentionally non-default: 3-space indentation, single quotes, no semicolons (`frontend/eslint.config.mjs`). Match existing style exactly.
- Frontend imports use the `@/` alias (`frontend/jsconfig.json`, `components.json`).
- Python code follows straightforward Scrapy/PEP 8 style; keep changes small and local to the scraper pipeline.

## Integration pitfalls to remember
- `frontend/src/lib/data.js` connects with `postgres(process.env.PGSQL_URL)`, so frontend pages require the same DB env var as the crawler.
- Search names are user-facing labels stored in DB; do not replace them with slugified values in queries or routes.
- When changing seller/car relationships, remember the frontend assumes seller data is joinable by `seller_id`.
- Do not "clean up" `crawler/output/` unless the task is explicitly about runtime data/configuration.
- localStorage keys used by the frontend: `'car-table-visible-columns'`, `'google-maps-api-key'`, `'home-address'`, `'search-runs-preferences'`. Avoid collisions.
- Seller types are only `'professional'` and `'private'`. Maps place details are only shown for professional sellers. Address building differs by type: private → "address, zip_code city", professional → "name, address, zip_code city".
- Screenshots are stored in Cloudflare R2 (not in the DB). The `screenshots` table holds only metadata and the R2 public URL. Car queries LEFT JOIN `screenshots` via `cars.screenshot_id` to get `screenshot_url`. The `/api/screenshot/[carId]` route redirects to the R2 URL. Backfill existing bytea data with `crawler/backfill_screenshots.py`.
- Listing photos are stored in R2 via the `photos` table (metadata) and `car_photos` junction table (car_id, photo_id, position). The `/api/photos/[carId]` route returns a JSON array of photo URLs. Car listing queries include a `photo_count` subquery. The lightbox component lazy-loads photos via `fetchMoreUrl` when opened.
- `photo_sources` (image_key → photo_id) is the crawler's pre-download cache and cascades on `photos` delete. Deleting a `photos` row therefore drops its key mappings, which is exactly what makes the next crawl re-download and re-store that image. Nothing in the frontend needs to touch `photo_sources` — but the cascade is why the orphan cleanup in `deleteSearch` still works, so do not weaken that FK.
- The `/api/car-screenshots/[vehicleId]` route accepts a `searchId` query param and returns a chronological list of screenshot URLs for a given vehicle — used by the lightbox to display screenshot history.
- R2 cleanup is the caller's responsibility: whenever a DB transaction deletes `screenshots` or `photos` rows, collect the `r2_key` values first, then call `deleteR2Objects(r2Keys)` from `frontend/src/lib/r2.js` **after** the transaction commits. It never throws — it returns `{ requestedCount, orphanedCount, reason }`, and the caller must pass that through `r2Warning()` and return the message in its action result so the UI can report orphaned files instead of a false success. See `deleteSearch`, `deleteSearchRun`, and `deleteOldScreenshots` in `actions.js` for the pattern. `r2.js` is `server-only`, never `'use server'` — exporting it as a Server Action would expose bucket deletion as an unauthenticated endpoint.
- The `searches` table has per-search `screenshots_enabled` and `photos_enabled` boolean columns (default `true`). The crawler spider reads these at startup and the `ScreenshotPipeline`/`PhotoPipeline` skip processing when the flag is `false`. When adding new per-search feature flags, update `SCHEMA.sql`, the spider constructor, the relevant pipeline, and the `updateSearch`/`toggleSearch*` actions together.
