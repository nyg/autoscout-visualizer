# AutoScout24 Crawler

[Scrapy spider](https://docs.scrapy.org/en/latest/topics/spiders.html) that scrapes AutoScout24 car listings and stores them in PostgreSQL.

## Table of Contents

- [Features](#features)
- [Installation](#installation)
- [Usage](#usage)
- [Headless Linux tips](#headless-linux-tips)

## Features

- Bypasses CloudFlare protection using [SeleniumBase CDP mode](https://github.com/nyg/scrapy-seleniumbase-cdp)
- Extracts vehicle details (price, mileage, specs) and seller information
- Failed requests are automatically retried up to 3 times (`RETRY_TIMES`) by Scrapy's built-in `RetryMiddleware`
- Stores data in PostgreSQL with batch tracking for historical analysis
- Archives every seller-uploaded listing photo and a full-page screenshot of each listing in Cloudflare R2, as deduplicated WebP
- Records each run in `search_runs` with its stats and a pass/fail verdict; `run-spiders.sh` exits non-zero when any search fails, so a cron job reports the failure
- Search configurations stored in database, manageable from the frontend Settings page
- Screenshot and photo capture can be turned off per search from the same page
- Sends a batch summary email after all spiders finish (requires [Resend](https://resend.com) API key)

## Installation

Install system dependencies:

```bash
sudo apt install chromium xvfb
```

Install [uv](https://docs.astral.sh/uv/getting-started/installation/) and sync dependencies:

```bash
uv sync
```

Create a PostgreSQL database and initialize the schema:

```bash
createdb autoscout24_trends
psql -d autoscout24_trends -f SCHEMA.sql
```

Create a `.env` file in the crawler directory (see `.env.example`):

```env
PGSQL_URL=postgresql://username:password@localhost:5432/autoscout24_trends
RESEND_API_KEY=re_YourApiKeyFromResendCom

R2_ENDPOINT_URL=https://<account-id>.r2.cloudflarestorage.com
R2_ACCESS_KEY_ID=…
R2_SECRET_ACCESS_KEY=…
R2_BUCKET_NAME=autoscout24-trends
R2_PUBLIC_URL=https://…
```

Only `PGSQL_URL` is required. Without the R2 variables the screenshot and photo pipelines log a warning and skip, and the crawl still stores listings; without `RESEND_API_KEY` no summary email is sent.

The email recipient is configured in the frontend Settings page (`/settings`).

## Usage

### Managing Searches

Searches are stored in the `searches` database table and managed from the frontend Settings page (`/settings`). Each search has:

- **name**: display label used in the UI; also what car rows are joined by, so renaming a search carries its history with it
- **url**: AutoScout24 search URL with filters
- **is_active**: whether the search is included in batch runs
- **screenshots_enabled** / **photos_enabled**: whether `ScreenshotPipeline` and `PhotoPipeline` run for this search

You can also insert searches directly via SQL:

```sql
INSERT INTO searches (name, url) VALUES ('Audi RS6 Avant', 'https://www.autoscout24.ch/en/cars/audi/rs-6?sort=standard&desc=0');
```

### Running

Run a single search by ID:

```bash
uv run scrapy crawl search -a search_id=1
```

Run all active searches (creates `.venv` if needed, updates dependencies, then starts all spiders):

```bash
./run-spiders.sh
```

### Cron Job

Schedule daily crawls:

```bash
crontab -e
```

```cron
0 0 * * * /path/to/crawler/run-spiders.sh
```

Logs are written to `$XDG_STATE_HOME/autoscout24-trends/` (defaults to `~/.local/state/autoscout24-trends/`) with daily rotation and 30-day retention, so the cron entry needs no shell-level output redirection.

You can override the log directory by setting the `XDG_STATE_HOME` environment variable.

## Headless Linux tips

When running the crawler headless with Xvfb on a Linux server, you may want to record or inspect browser sessions for debugging. See the [Tips for headless Linux environments](https://github.com/nyg/scrapy-seleniumbase-cdp#tips-for-headless-linux-environments) section in the `scrapy-seleniumbase-cdp` README for instructions on:

- **Recording an Xvfb session** with `ffmpeg`
- **Connecting via VNC** to a live Xvfb session with `x11vnc`
