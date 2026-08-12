from collections.abc import Callable, Generator
from typing import Any
from urllib.parse import urlencode, urlparse, urlunparse

import njsparser
from scrapy import Spider
from scrapy.http import Response
from scrapy.spidermiddlewares.httperror import HttpError
from scrapy_seleniumbase_cdp import SeleniumBaseRequest
from twisted.python.failure import Failure

from ..items import CarItem, SellerItem

ACCEPT_COOKIES_AND_EXPAND_FIELDS = {
    'await_promise': True,
    'script': '''
        document.getElementById('onetrust-accept-btn-handler')?.click();
        [...document.querySelectorAll('button[aria-expanded="false"]')].slice(1).forEach(b => b.click())
        new Promise(resolve => setTimeout(resolve, 1000))
    '''
}


class SearchPageRequest(SeleniumBaseRequest):
    """Request for a search result page."""

    def __init__(self, spider: SearchSpider | None = None, **kwargs) -> None:
        if spider:
            kwargs.update(callback=spider.parse, errback=spider.handle_error, wait_for_element='h1')
        super().__init__(**kwargs)


class CarPageRequest(SeleniumBaseRequest):
    """Request for a car page."""

    def __init__(self, spider: SearchSpider | None = None, **kwargs) -> None:
        if spider:
            kwargs.update(callback=spider.parse_car,
                          errback=spider.handle_error,
                          wait_for_element='h1',
                          script=ACCEPT_COOKIES_AND_EXPAND_FIELDS,
                          screenshot=spider.screenshots_enabled)
        super().__init__(**kwargs)


class SearchSpider(Spider):
    name = 'search'
    allowed_domains = ['www.autoscout24.ch', 'autoscout24.ch']

    def __init__(self, search_id: int | str, search_name: str, url: str,
                 screenshots_enabled: bool | str = True,
                 photos_enabled: bool | str = True, *args, **kwargs) -> None:
        super().__init__(*args, **kwargs)
        self.search_id = int(search_id)
        self.search_name = search_name
        self.url = urlparse(url)
        self.screenshots_enabled = screenshots_enabled if isinstance(screenshots_enabled, bool) else screenshots_enabled != 'false'
        self.photos_enabled = photos_enabled if isinstance(photos_enabled, bool) else photos_enabled != 'false'
        self.failed_requests: list[dict[str, str | int]] = []
        self.total_car_count = 0

    async def start(self) -> Generator:
        start_url = self._result_page_url()
        self.logger.info(f'Starting crawl with URL: {start_url}')
        yield SearchPageRequest(self, url=start_url)

    def parse(self, response: Response, **kwargs) -> Generator:
        """Parse the search result page using flight data."""
        try:
            page_index, page_count, total_car_count, listings = self._extract_search_results(response)
        except Exception as e:
            self.failed_requests.append({'url': self._requested_url(response), 'reason': f'search page parsing failed: {e!r}'})
            raise

        self.logger.info(f'Parsing search page: {page_index + 1}/{page_count} {response.url}')

        self.total_car_count = total_car_count

        for listing in listings:
            car_url = self._listing_url(listing)
            self.logger.info(f'Car found: {car_url}')
            yield CarPageRequest(self, url=car_url)

        next_page = page_index + 1
        if next_page < page_count:
            yield SearchPageRequest(self, url=self._result_page_url(next_page))

    def parse_car(self, response: Response) -> Generator:
        try:
            self.logger.info(f'Parsing car: {response.url}')
            listing_data = self._extract_listing_data(response.body)
            yield SellerItem.from_listing(listing_data['seller'])
            yield CarItem.from_listing(self.search_id, response.url, response.meta.get('screenshot'), listing_data)
        except Exception as e:
            self.logger.error(f'Error parsing car: {e}')
            self.failed_requests.append({'url': self._requested_url(response), 'reason': f'car page parsing failed: {e!r}'})

    @staticmethod
    def _extract_search_results(response: Response) -> tuple[int, int, int, list[dict[str, Any]]]:
        """Extract Next.js flight data describing the search results, including pagination info and listing URLs."""
        fd = njsparser.BeautifulFD(response.body)
        prefetched, _ = SearchSpider._find_nested_key(fd, 'prefetchedListings', lambda e: 'totalPages' in e)
        return prefetched['number'], prefetched['totalPages'], prefetched['totalElements'], prefetched['content']

    @staticmethod
    def _extract_listing_data(body: bytes) -> dict[str, Any]:
        """Extract Next.js flight data describing the vehicle and seller."""
        fd = njsparser.BeautifulFD(body)

        pvt, parent = SearchSpider._find_nested_key(fd, 'pageViewTracking', lambda e: e['englishVirtualPagePath'] == 'details')
        listing, _ = SearchSpider._find_nested_key(parent, 'listing')
        seller, _ = SearchSpider._find_nested_key(parent, 'seller')

        if not pvt or not listing or not seller:
            raise ValueError(
                f'Could not extract complete listing data: pvt={pvt is not None}, listing={listing is not None}, seller={seller is not None}')

        # sometimes, description is a reference (e.g. "$31") pointing to a separate Text node instead of being inlined
        text = {hex(t.index).replace('0x', '$'): t.value for t in fd.find_iter([njsparser.T.Text])}
        if listing.get('description') in text:
            listing['description'] = text[listing['description']]

        return {
            'pageViewTracking': pvt,
            'listing': listing,
            'seller': seller,
        }

    @staticmethod
    def _find_nested_key(
        obj: Any,
        key: str,
        condition: Callable[[Any], bool] = lambda e: True,
        _depth: int = 0,
    ) -> tuple[Any, dict | None]:
        """Recursively search for a key in nested dict/list structure.
        Accepts a BeautifulFD (searches all Data node contents) or a dict/list.
        Returns (value, parent_dict) if found, or (None, None)."""
        if _depth > 20:
            return None, None

        match obj:
            case njsparser.BeautifulFD():
                for data_node in obj.find_iter([njsparser.T.Data]):
                    if data_node.content is not None:
                        result, parent = SearchSpider._find_nested_key(data_node.content, key, condition)
                        if result is not None:
                            return result, parent

            case dict():
                if key in obj:
                    try:
                        if condition(obj[key]):
                            return obj[key], obj
                    except Exception:
                        pass
                for v in obj.values():
                    result, parent = SearchSpider._find_nested_key(v, key, condition, _depth + 1)
                    if result is not None:
                        return result, parent

            case list():
                for entry in obj:
                    result, parent = SearchSpider._find_nested_key(entry, key, condition, _depth + 1)
                    if result is not None:
                        return result, parent

        return None, None

    @staticmethod
    def _requested_url(response: Response) -> str:
        return response.request.url if response.request else response.url

    def _listing_url(self, listing: dict[str, Any]) -> str:
        return f'{self.url.scheme}://{self.url.netloc}/en/d/{listing['id']}'

    def _result_page_url(self, page: int = 0) -> str:
        query = f'{self.url.query}&{urlencode({'pagination[page]': page})}' if self.url.query else urlencode({'pagination[page]': page})
        return urlunparse(self.url._replace(query=query))

    def handle_error(self, failure: Failure) -> None:
        """Handle request errors by logging the failed URL and reason, and storing it for summary on spider close."""
        reason = failure.value.response.status if failure.check(HttpError) else repr(failure.value)
        self.failed_requests.append({'url': failure.request.url, 'reason': reason})

    def closed(self, reason: str) -> None:
        """Log a summary of failed URLs when the spider finishes, if there are any."""
        if self.failed_requests:
            self.logger.warning(f'{len(self.failed_requests)} requests have failed:')
            for entry in self.failed_requests:
                self.logger.warning(f"  Scraping {entry['url']} failed due to: {entry['reason']}")

        self.crawler.stats.set_value('failed_urls', self.failed_requests)
