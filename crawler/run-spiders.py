#!/usr/bin/env python3
"""Run all autoscout24-trends spiders programmatically.

Reads active searches from the PostgreSQL database and launches one spider
per search.  Uses Scrapy's CrawlerRunner API to keep them strictly sequential.
No subprocess is involved; the Twisted reactor is shared across all runs.

Usage (from within the activated virtual environment):
    python run-spiders.py [--id=1,2,3]

Options:
    --id=1,2,3   Comma-separated list of search IDs to run (default: all active)
"""

import logging
import logging.handlers
import os
import sys
import warnings
from datetime import datetime, timezone
from pathlib import Path

# Suppress the Pydantic V1 compatibility warning emitted by itemadapter on
# Python 3.14+.  It fires at import time, before we can configure Scrapy
# logging, so a warnings filter is the only reliable way to silence it.
warnings.filterwarnings('ignore', message=r".*Pydantic V1.*")

import psycopg
from dotenv import load_dotenv

load_dotenv()

# The SeleniumBase CDP middleware requires the asyncio reactor.  Scrapy's
# install_reactor() must run before any import of twisted.internet.reactor
# so the correct reactor singleton is in place when Scrapy validates it.
from scrapy.utils.reactor import install_reactor
install_reactor('twisted.internet.asyncioreactor.AsyncioSelectorReactor')

from scrapy.crawler import CrawlerRunner  # noqa: E402
from scrapy.utils.log import configure_logging  # noqa: E402
from scrapy.utils.project import get_project_settings  # noqa: E402
from twisted.internet import defer, reactor  # noqa: E402

from autoscout.email import send_batch_summary_email  # noqa: E402
from autoscout.spiders.search import SearchSpider  # noqa: E402

SCRIPT_DIR = Path(__file__).parent.resolve()

log = logging.getLogger(__name__)


def _setup_file_logging() -> Path | None:
    """Add a daily-rotating file handler to the root logger.

    Writes to $XDG_STATE_HOME/autoscout24-trends/ (default
    ~/.local/state/autoscout24-trends/).  Returns the log directory path,
    or None if setup failed.
    """
    xdg_state = os.environ.get('XDG_STATE_HOME', os.path.expanduser('~/.local/state'))
    log_dir = Path(xdg_state) / 'autoscout24-trends'
    try:
        log_dir.mkdir(parents=True, exist_ok=True)
    except OSError:
        log.warning('Cannot create log directory %s, file logging disabled', log_dir)
        return None

    log_file = log_dir / 'crawl.log'
    handler = logging.handlers.TimedRotatingFileHandler(
        log_file, when='midnight', backupCount=30, encoding='utf-8')
    handler.setLevel(logging.INFO)
    handler.setFormatter(logging.Formatter(
        '%(asctime)s [%(levelname)s] %(name)s: %(message)s',
        datefmt='%Y-%m-%d %H:%M:%S'))
    logging.getLogger().addHandler(handler)
    return log_dir


def _parse_id_filter(argv: list[str]) -> set[int] | None:
    """Return a set of integer IDs from a --id=1,2,3 argument, or None."""
    for arg in argv:
        if arg.startswith('--id='):
            return {int(x) for x in arg.removeprefix('--id=').split(',') if x.strip()}
    return None


def main() -> None:
    # Anchor the working directory so Scrapy finds the project settings,
    # regardless of where this script is invoked from.
    os.chdir(SCRIPT_DIR)

    settings = get_project_settings()

    # CrawlerRunner does not configure logging on its own (unlike
    # CrawlerProcess), so we do it explicitly to see spider output.
    configure_logging(settings)

    log_dir = _setup_file_logging()
    if log_dir:
        log.info('File logging enabled: %s (daily rotation, 30-day retention)', log_dir)

    id_filter = _parse_id_filter(sys.argv[1:])

    with psycopg.connect(os.environ['PGSQL_URL'], connect_timeout=1) as conn:
        with conn.cursor() as cur:
            searches: list[tuple[int, str, str, bool, bool]] = cur.execute(
                'SELECT id, name, url, screenshots_enabled, photos_enabled FROM searches WHERE is_active = true ORDER BY name'
            ).fetchall()

    if id_filter is not None:
        searches = [(sid, name, url, ss, pe) for sid, name, url, ss, pe in searches if sid in id_filter]

    if not searches:
        log.warning('No active searches found in database')
        return

    # CrawlerRunner, unlike CrawlerProcess, does not own the reactor lifecycle.
    # We start it manually below and stop it once all crawlers have finished.
    runner = CrawlerRunner(settings)
    batch_started_at = datetime.now(timezone.utc)
    crawlers = []

    @defer.inlineCallbacks
    def crawl_all():
        try:
            for search_id, search_name, url, screenshots_enabled, photos_enabled in searches:
                log.info('Running spider for search: %s (id=%d)', search_name, search_id)
                crawler = runner.create_crawler(SearchSpider)
                crawlers.append(crawler)
                yield runner.crawl(crawler, search_id=search_id, search_name=search_name, url=url,
                                   screenshots_enabled=screenshots_enabled,
                                   photos_enabled=photos_enabled)
        except Exception:
            log.exception('Spider run failed')
        finally:
            send_batch_summary_email(batch_started_at, [s[0] for s in searches])
            reactor.stop()

    d = crawl_all()  # noqa: F841 – hold a reference so Twisted won't GC the deferred
    reactor.run()

    successful = sum(1 for crawler in crawlers if crawler.stats and crawler.stats.get_value('run_success'))
    if successful != len(searches):
        log.error('%d of %d searches did not complete successfully', len(searches) - successful, len(searches))
        sys.exit(1)


if __name__ == '__main__':
    main()
