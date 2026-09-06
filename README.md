# AutoScout24 Trends

A car listing analytics platform that scrapes vehicle data from AutoScout24.ch, stores it in a PostgreSQL database, and provides a web interface to visualize trends and insights.

![AutoScout24 Trends frontpage](demo.png)

## Overview

This project consists of two main components:

1. **[Crawler](crawler/README.md)** — A Scrapy-based web scraper that extracts car listings from AutoScout24
2. **[Frontend](frontend/README.md)** — A Next.js web application that visualizes the collected data with charts and analytics

The system enables users to track car listings over time, analyze pricing trends, monitor availability, and compare historical data across different searches.

Both components read the same PostgreSQL database and the same Cloudflare R2 bucket; `crawler/SCHEMA.sql` is the contract between them. Setup instructions live in each component's README.

Repository conventions and architecture notes for contributors — human or agent — are in [AGENTS.md](AGENTS.md).

## Features

- **Automated Web Scraping**: Bypasses anti-bot protections using SeleniumBase CDP mode
- **Database Storage**: Persists car, seller, and search configuration data in PostgreSQL
- **Photo Archival**: Downloads and stores all seller-uploaded listing photos in Cloudflare R2 (WebP, deduplicated)
- **Screenshot Capture**: Takes full-page screenshots of car listings, compressed and stored in R2
- **Data Visualization**: Interactive charts and tables for analyzing trends
- **Price History**: Tracks every price change per vehicle across crawls, with the full change timeline per listing
- **Image Lightbox**: Full-screen viewer for screenshots and listing photos with keyboard navigation
- **Search Management**: Configure and manage searches from the web UI, including per-search screenshot and photo toggles
- **Run History**: Every crawl is recorded with its stats and a pass/fail verdict, browsable and filterable in the UI
- **Storage Housekeeping**: Storage usage charts, retention-based image cleanup, and on-demand reconciliation of the database against R2
