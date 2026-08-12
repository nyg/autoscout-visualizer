import os
from typing import Any

import psycopg
from psycopg.types.json import Jsonb
from scrapy import signals
from scrapy.crawler import Crawler


class SearchRunExtension:
    """Records each spider run in the search_runs table with stats.

    Uses spider_opened/spider_closed signals (not pipeline open/close_spider)
    so that CoreStats has already set finish_time, finish_reason, etc.

    Owns the shared DB connection lifecycle: creates it in spider_opened,
    attaches it to crawler.db_connection for pipelines to reuse, and closes
    it in spider_closed (which fires after pipeline close_spider).
    """

    def __init__(self, crawler: Crawler) -> None:
        self.crawler = crawler
        self.connection: psycopg.Connection | None = None
        self.search_run_id: int | None = None

    @classmethod
    def from_crawler(cls, crawler: Crawler) -> SearchRunExtension:
        ext = cls(crawler)
        crawler.signals.connect(ext.spider_opened, signal=signals.spider_opened)
        crawler.signals.connect(ext.spider_closed, signal=signals.spider_closed)
        return ext

    def spider_opened(self) -> None:
        """Create a shared DB connection and a search_runs row, then publish search_run_id to Scrapy stats."""
        self.connection = psycopg.connect(os.environ['PGSQL_URL'], connect_timeout=self.crawler.settings.getint('PGSQL_CONNECT_TIMEOUT'))
        self.crawler.db_connection = self.connection
        with self.connection.transaction():
            with self.connection.cursor() as cursor:
                (self.search_run_id,) = cursor.execute(
                    'INSERT INTO search_runs (search_id, started_at) VALUES (%s, %s) RETURNING id',
                    (self.crawler.spider.search_id, self.crawler.stats.get_value('start_time'))
                ).fetchone()
        self.crawler.stats.set_value('search_run_id', self.search_run_id)
        self.crawler.spider.logger.info(f'Created search run {self.search_run_id}')

    def spider_closed(self) -> None:
        """Update the search_runs row with final stats."""
        try:
            stats: dict[str, Any] = self.crawler.stats.get_stats()

            cars_scraped = stats.get('db/cars_inserted', 0)
            cars_found = self.crawler.spider.total_car_count
            failed_request_count = len(self.crawler.spider.failed_requests)
            request_count = stats.get('response_received_count', 0)
            finish_reason = stats.get('finish_reason', 'unknown')
            spider_exception_count = stats.get('spider_exceptions/count', 0)
            success = cars_found == cars_scraped and not failed_request_count and not spider_exception_count
            self.crawler.stats.set_value('run_success', success)

            with self.connection.transaction():
                with self.connection.cursor() as cursor:
                    cursor.execute('''
                        UPDATE search_runs
                           SET finished_at = %s,
                               finish_reason = %s,
                               success = %s,
                               cars_found = %s,
                               cars_scraped = %s,
                               request_count = %s,
                               failed_request_count = %s,
                               stats = %s
                         WHERE id = %s
                    ''', (
                        stats.get('finish_time'),
                        finish_reason,
                        success,
                        cars_found,
                        cars_scraped,
                        request_count,
                        failed_request_count,
                        Jsonb({k: str(v) for k, v in stats.items()}),
                        self.search_run_id))
            self.crawler.spider.logger.info(f'Updated search run {self.search_run_id}')
        except Exception as e:
            self.crawler.spider.logger.error(f'Failed to update search run: {e}', exc_info=True)
        finally:
            if self.connection:
                self.connection.close()
                self.crawler.db_connection = None
                self.crawler.spider.logger.info('Shared database connection closed')
