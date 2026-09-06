# AutoScout24 Trends — Frontend

Next.js application that visualizes car listing data scraped by the crawler.

## Table of Contents

- [Features](#features)
- [Installation](#installation)
- [Usage](#usage)
- [Updating shadcn/ui Components](#updating-shadcnui-components)
- [Project Structure](#project-structure)
- [Locale Formatting](#locale-formatting)

## Features

- Built with Next.js 16, React 19, Tailwind CSS 4, shadcn/ui-generated primitives, and Recharts 3
- Search-based navigation via dynamic routes, with three tabs per search: active listings, previous listings, and price history
- Active listings table with sortable, hideable columns, seller details and Google Places lookup
- Historical charts for listing count, average price, and mileage, plus a price-vs-mileage scatter plot
- Full-screen lightbox for listing photos and the screenshot history of a vehicle
- Search runs page with server-side pagination, date filtering and per-run stats
- Settings page: search CRUD, per-search screenshot/photo toggles, storage usage charts, image cleanup, and DB/R2 reconciliation

## Installation

Install dependencies:

```bash
pnpm install
```

Create a `.env` file:

```env
PGSQL_URL=postgresql://username:password@localhost:5432/autoscout24_trends

R2_ENDPOINT_URL=https://<account-id>.r2.cloudflarestorage.com
R2_ACCESS_KEY_ID=…
R2_SECRET_ACCESS_KEY=…
R2_BUCKET_NAME=autoscout24-trends
```

`PGSQL_URL` is all that is needed to browse listings. The R2 variables are used by `src/lib/r2.js` to delete and list objects, and must point at the same bucket the crawler writes to. Without them the reconciliation scan in Settings refuses to run, and the image cleanup actions still delete their database rows but report the objects they could not remove as orphaned rather than failing silently.

The Google Maps API key, home address and summary-email recipient are not environment variables — they are stored in the database `config` table and edited in the Settings page.

## Usage

Start the development server:

```bash
pnpm dev
```

## Updating shadcn/ui Components

This frontend uses the shadcn CLI with the config in `components.json`:

- generated components live under `src/components/ui/`
- Tailwind CSS is configured through `src/app/globals.css`
- imports use the `@/` aliases from `components.json` and `jsconfig.json`

To add a new component from the registry:

```bash
pnpm dlx shadcn@latest add <component>
```

To refresh an existing generated component, run the same command again for that component and review the diff before keeping local customizations:

```bash
pnpm dlx shadcn@latest add card
pnpm dlx shadcn@latest add table
pnpm dlx shadcn@latest add chart
```

After regenerating components, run:

```bash
pnpm lint
pnpm build
```

Notes for this repo:

- Keep generated UI code aligned with the existing style rules: 3-space indentation, single quotes, and no semicolons.
- Prefer the existing local primitives in `src/components/ui/` over introducing another component system.
- `components.json` still uses `"iconLibrary": "lucide"`, so adding or refreshing components that depend on icons may re-introduce `lucide-react`.

## Project Structure

```
frontend/
├── src/
│   ├── app/                              # Next.js App Router
│   │   ├── layout.js                     # Root layout, locale detection
│   │   ├── page.js                       # Home page
│   │   ├── globals.css                   # Tailwind CSS v4 config
│   │   ├── search/[searchName]/page.js   # Search detail page (active / previous / history tabs)
│   │   ├── search-runs/page.js           # Paginated crawl run history
│   │   ├── settings/page.js              # Searches, config, storage, reconciliation
│   │   └── api/                          # Screenshot and photo URL routes
│   ├── components/
│   │   ├── navbar.js                     # Navigation bar
│   │   ├── search-dropdown.js            # Search selector
│   │   ├── search-tabs.js                # Per-search tab navigation
│   │   ├── cars.js                       # Car listings table
│   │   ├── price-history.js              # Price-changed listings table
│   │   ├── lightbox.js                   # Full-screen image viewer
│   │   ├── place-details.js              # Google Places seller lookup
│   │   ├── daily-listing-count.js        # Listing count / price / mileage chart
│   │   ├── mileage-price-comparison.js   # Mileage vs price scatter chart
│   │   ├── chart-utils.jsx               # Shared Recharts helpers
│   │   ├── search-manager.js             # Search CRUD UI
│   │   ├── client-settings.js            # Maps key, home address, email recipient
│   │   ├── image-storage.js              # Storage charts and cleanup UI
│   │   ├── storage-reconciliation.js     # DB/R2 reconciliation UI
│   │   ├── search-runs.js                # Search runs table and controls
│   │   └── ui/                           # shadcn-generated primitives
│   └── lib/
│       ├── data.js                       # Database reads
│       ├── actions.js                    # Server Actions (database writes)
│       ├── r2.js                         # Cloudflare R2 client (server-only)
│       ├── reconcile.js                  # Pure DB/R2 classification logic
│       ├── format.js                     # Formatter factory & locale parser
│       ├── formatter-context.js          # React Context provider & hook
│       └── utils.js                      # Class name helper
├── components.json                       # shadcn CLI config
├── eslint.config.mjs                     # Lint and style rules
├── postcss.config.mjs                    # PostCSS / Tailwind plugin
└── package.json                          # Dependencies and scripts
```

## Locale Formatting

All number and date formatting uses the browser's `Accept-Language` HTTP header to select the locale, with `en-US` as fallback. A single set of formatters is created once and shared via **React Context** — a React mechanism that lets a parent component provide data to all its descendants without passing props through every level.

```mermaid
sequenceDiagram
    participant Browser
    participant RootLayout as Root Layout<br/>(server component)
    participant Format as format.js
    participant Provider as FormatterProvider<br/>(client component)
    participant Component as Component<br/>(cars, charts, etc.)

    Browser->>RootLayout: HTTP request with Accept-Language header
    RootLayout->>Format: parseAcceptLanguage(header)
    Format-->>RootLayout: locale string (e.g. "en-US")
    RootLayout->>Provider: <FormatterProvider locale="en-US">
    Provider->>Format: createFormatters("en-US")
    Format-->>Provider: { asDecimal, asBytes, asShortDate, asMediumDate,<br/>asShortMonthYearDate, asShortDayMonthDate, asTime }
    Provider->>Provider: Store in FormatterContext (React Context)
    Component->>Provider: useFormatter()
    Provider-->>Component: formatter object
    Component->>Component: fmt.asDecimal(42000) → "42,000"
```

### How it works

1. **`Accept-Language` header** — Every HTTP request the browser sends includes this header automatically, based on the user's OS/browser language settings (e.g. `en-US,en;q=0.9,fr;q=0.8`). This is the same locale information as `navigator.language`, but available server-side.

2. **`parseAcceptLanguage()`** (`format.js`) — Extracts the preferred locale from the header. Falls back to `en-US` if the header is missing.

3. **`FormatterProvider`** (`formatter-context.js`) — A client component that wraps the app. It receives the locale string from the root layout, creates `Intl`-based formatters via `createFormatters(locale)`, and stores them in a `FormatterContext` (a React Context object). Because the locale is serialized from the server into the React tree, both SSR and client hydration use the exact same value — no mismatches.

4. **`useFormatter()`** — Any component calls this hook to get the formatter object `{ asDecimal, asBytes, asShortDate, asMediumDate, asShortMonthYearDate, asShortDayMonthDate, asTime }`. No locale prop drilling needed.

`asBytes` is part of the same set on purpose: byte sizes are **decimal** (divided by 1000, labelled B/KB/MB/GB/TB) to match how Cloudflare bills and displays R2 storage. Formatting bytes outside the locale formatter would lose both the digit grouping and that convention.
