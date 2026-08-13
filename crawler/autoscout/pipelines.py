import dataclasses
import hashlib
import io
import os
import uuid
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from typing import Any

import psycopg
import requests
from psycopg import Cursor, sql
from psycopg.types.json import Jsonb
from requests.adapters import HTTPAdapter
from scrapy.crawler import Crawler
from scrapy.statscollectors import StatsCollector

from .items import CarItem, SellerItem


def get_shared_connection(crawler: Crawler) -> psycopg.Connection:
    """Return the shared DB connection owned by SearchRunExtension.

    The connection is created in SearchRunExtension.spider_opened and stored
    on the crawler instance so that pipelines can reuse it without opening
    a second connection.
    """
    connection = getattr(crawler, 'db_connection', None)
    if connection is None:
        raise RuntimeError(
            'Shared DB connection not available. '
            'Ensure SearchRunExtension is enabled and has run spider_opened.')
    return connection


class ScreenshotPipeline:
    """Compresses screenshots to WebP, deduplicates via MD5, and uploads to Cloudflare R2."""

    def __init__(self, crawler: Crawler) -> None:
        self.crawler = crawler
        self.s3_client: Any = None
        self.r2_configured = all(os.environ.get(k) for k in (
            'R2_ENDPOINT_URL', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY',
            'R2_BUCKET_NAME', 'R2_PUBLIC_URL'))
        self.bucket_name = os.environ.get('R2_BUCKET_NAME')
        self.public_url = (os.environ.get('R2_PUBLIC_URL') or '').rstrip('/')

    @classmethod
    def from_crawler(cls, crawler: Crawler) -> ScreenshotPipeline:
        return cls(crawler)

    def open_spider(self) -> None:
        if not self.r2_configured:
            self.crawler.spider.logger.warning('R2 not configured — screenshots will not be uploaded')

    def close_spider(self) -> None:
        pass

    def process_item(self, item: CarItem | SellerItem) -> CarItem | SellerItem:
        if not isinstance(item, CarItem):
            return item

        screenshot_data = item.screenshot
        item.screenshot = None
        item.screenshot_id = None

        if screenshot_data and self.r2_configured:
            self._upload_screenshot(item, screenshot_data)

        return item

    def _upload_screenshot(self, item: CarItem, screenshot_data: bytes) -> None:
        try:
            self._ensure_s3_client()
            connection = get_shared_connection(self.crawler)
            webp_data, width, height, original_size = self._compress(screenshot_data)
            compressed_size = len(webp_data)
            md5_hash = hashlib.md5(webp_data).hexdigest()

            with connection.transaction():
                with connection.cursor() as cursor:
                    cursor.execute('SELECT id FROM screenshots WHERE md5_hash = %s', (md5_hash,))

                    if existing := cursor.fetchone():
                        item.screenshot_id = existing[0]
                        self.crawler.spider.logger.info(
                            f'Screenshot for {item.vehicle_id}: dedup hit (hash={md5_hash[:8]})')
                    else:
                        r2_key = f'screenshots/{uuid.uuid4()}.webp'
                        r2_url = f'{self.public_url}/{r2_key}'

                        self.s3_client.put_object(
                            Bucket=self.bucket_name,
                            Key=r2_key,
                            Body=webp_data,
                            ContentType='image/webp')

                        cursor.execute('''
                            INSERT INTO screenshots (md5_hash, r2_key, r2_url, format, width, height, original_size, compressed_size)
                            VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                            RETURNING id
                        ''', (md5_hash, r2_key, r2_url, 'webp', width, height, original_size, compressed_size))
                        item.screenshot_id = cursor.fetchone()[0]

                        self.crawler.spider.logger.info(
                            f'Screenshot for {item.vehicle_id}: '
                            f'{original_size / 1024:.0f}KB → {compressed_size / 1024:.0f}KB '
                            f'({compressed_size / original_size * 100:.0f}%), hash={md5_hash[:8]}')
        except Exception as e:
            self.crawler.spider.logger.error(f'Screenshot processing failed for {item.vehicle_id}: {e}')

    def _ensure_s3_client(self) -> None:
        if self.s3_client is None:
            import boto3
            self.s3_client = boto3.client(
                's3',
                endpoint_url=os.environ['R2_ENDPOINT_URL'],
                aws_access_key_id=os.environ['R2_ACCESS_KEY_ID'],
                aws_secret_access_key=os.environ['R2_SECRET_ACCESS_KEY'],
                region_name='auto')

    @staticmethod
    def _compress(png_data: bytes) -> tuple[bytes, int, int, int]:
        from PIL import Image
        from PIL.Image import Resampling
        img = Image.open(io.BytesIO(png_data))
        width, height = img.size
        # WebP format limit: max 16383px in either dimension
        max_dim = 16383
        if width > max_dim or height > max_dim:
            scale = min(max_dim / width, max_dim / height)
            width = int(width * scale)
            height = int(height * scale)
            img = img.resize((width, height), Resampling.LANCZOS)
        webp_buffer = io.BytesIO()
        img.save(webp_buffer, format='WebP', quality=80)
        return webp_buffer.getvalue(), width, height, len(png_data)


@dataclass(slots=True)
class EncodedPhoto:
    image_key: str
    position: int
    md5_hash: str
    webp: bytes
    width: int
    height: int
    original_size: int


class PhotoPipeline:
    """Downloads listing photos, compresses to WebP, deduplicates via MD5, and uploads to R2."""

    PHOTO_BASE_URL = 'https://listing-images.autoscout24.ch/'

    def __init__(self, crawler: Crawler) -> None:
        self.crawler = crawler
        self.s3_client: Any = None
        self.executor: ThreadPoolExecutor | None = None
        self.r2_configured = all(os.environ.get(k) for k in (
            'R2_ENDPOINT_URL', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY',
            'R2_BUCKET_NAME', 'R2_PUBLIC_URL'
        ))
        self.bucket_name = os.environ.get('R2_BUCKET_NAME')
        self.public_url = (os.environ.get('R2_PUBLIC_URL') or '').rstrip('/')
        self.workers = crawler.settings.getint('PHOTO_WORKERS')
        self.session = requests.Session()
        self.session.mount('https://', HTTPAdapter(pool_connections=self.workers, pool_maxsize=self.workers))

    @classmethod
    def from_crawler(cls, crawler: Crawler) -> 'PhotoPipeline':
        return cls(crawler)

    def open_spider(self) -> None:
        if not self.r2_configured:
            self.crawler.spider.logger.warning('R2 not configured — photos will not be downloaded')
            return

        import boto3
        self.s3_client = boto3.client(
            's3',
            endpoint_url=os.environ['R2_ENDPOINT_URL'],
            aws_access_key_id=os.environ['R2_ACCESS_KEY_ID'],
            aws_secret_access_key=os.environ['R2_SECRET_ACCESS_KEY'],
            region_name='auto',
        )
        self.executor = ThreadPoolExecutor(max_workers=self.workers, thread_name_prefix='photo')

    def close_spider(self) -> None:
        if self.executor:
            self.executor.shutdown(wait=True)
        self.session.close()

    def process_item(self, item: CarItem | SellerItem) -> CarItem | SellerItem:
        if not isinstance(item, CarItem) or not item.image_keys or not self.r2_configured:
            return item
        if not self.crawler.spider.photos_enabled:
            return item

        item.photo_refs = self._process_photos(item)
        return item

    def _process_photos(self, item: CarItem) -> list[tuple[int, int]]:
        """Download, compress, deduplicate, and upload all listing photos."""
        logger = self.crawler.spider.logger

        try:
            connection = get_shared_connection(self.crawler)
            known = self._resolve_known_keys(connection, item.image_keys)

            resolved: dict[int, int] = {}
            pending: list[tuple[int, str]] = []
            for position, image_key in enumerate(item.image_keys):
                if (photo_id := known.get(image_key)) is not None:
                    resolved[position] = photo_id
                else:
                    pending.append((position, image_key))

            key_hits = len(resolved)
            self.crawler.stats.inc_value('photos/key_hit', key_hits)

            if pending:
                encoded = self._fetch_and_encode(item, pending)
                resolved.update(self._store(connection, encoded))

            photo_refs = sorted(resolved.items())
            logger.info(
                f'Photos for {item.vehicle_id}: {len(photo_refs)}/{len(item.image_keys)} stored '
                f'({key_hits} cached, {len(pending)} fetched)')
            return photo_refs
        except Exception as e:
            logger.error(f'Photo processing failed for {item.vehicle_id}: {e}', exc_info=True)
            self.crawler.stats.inc_value('photos/car_failed')
            return []

    def _resolve_known_keys(self, connection: psycopg.Connection, image_keys: list[str]) -> dict[str, int]:
        with connection.transaction():
            with connection.cursor() as cursor:
                cursor.execute(
                    'SELECT image_key, photo_id FROM photo_sources WHERE image_key = ANY(%s)',
                    (image_keys,))
                return dict(cursor.fetchall())

    def _fetch_and_encode(self, item: CarItem, pending: list[tuple[int, str]]) -> list[EncodedPhoto]:
        logger = self.crawler.spider.logger
        encoded = []

        futures = {self.executor.submit(self._download_and_encode, position, image_key): image_key
                   for position, image_key in pending}
        for future in as_completed(futures):
            try:
                encoded.append(future.result())
            except Exception as e:
                logger.warning(f'Photo download failed for {item.vehicle_id} key={futures[future]}: {e}')
                self.crawler.stats.inc_value('photos/failed')

        self.crawler.stats.inc_value('photos/downloaded', len(encoded))
        return encoded

    def _download_and_encode(self, position: int, image_key: str) -> EncodedPhoto:
        response = self.session.get(f'{self.PHOTO_BASE_URL}{image_key}', timeout=15)
        response.raise_for_status()
        webp_data, width, height, original_size = self._compress_photo(response.content)
        return EncodedPhoto(
            image_key=image_key,
            position=position,
            md5_hash=hashlib.md5(webp_data).hexdigest(),
            webp=webp_data,
            width=width,
            height=height,
            original_size=original_size)

    def _store(self, connection: psycopg.Connection, encoded: list[EncodedPhoto]) -> dict[int, int]:
        by_hash: dict[str, EncodedPhoto] = {}
        for photo in encoded:
            by_hash.setdefault(photo.md5_hash, photo)

        photo_ids = self._match_existing_hashes(connection, list(by_hash))
        self.crawler.stats.inc_value('photos/md5_hit', len(photo_ids))

        uploaded = self._upload_photos([photo for md5_hash, photo in by_hash.items() if md5_hash not in photo_ids])

        with connection.transaction():
            with connection.cursor() as cursor:
                inserted = self._insert_photos(cursor, uploaded)
                photo_ids |= inserted
                self._record_sources(cursor, encoded, photo_ids)

        self.crawler.stats.inc_value('photos/uploaded', len(inserted))
        return {photo.position: photo_ids[photo.md5_hash] for photo in encoded if photo.md5_hash in photo_ids}

    def _match_existing_hashes(self, connection: psycopg.Connection, hashes: list[str]) -> dict[str, int]:
        if not hashes:
            return {}
        with connection.transaction():
            with connection.cursor() as cursor:
                cursor.execute('SELECT md5_hash, id FROM photos WHERE md5_hash = ANY(%s::bpchar[])', (hashes,))
                return dict(cursor.fetchall())

    def _upload_photos(self, photos: list[EncodedPhoto]) -> list[tuple[EncodedPhoto, str, str]]:
        logger = self.crawler.spider.logger
        uploaded = []

        futures = {self.executor.submit(self._upload_photo, photo): photo for photo in photos}
        for future in as_completed(futures):
            photo = futures[future]
            try:
                uploaded.append((photo, *future.result()))
            except Exception as e:
                logger.error(f'Photo upload failed for key={photo.image_key}: {e}')
                self.crawler.stats.inc_value('photos/failed')

        return uploaded

    def _upload_photo(self, photo: EncodedPhoto) -> tuple[str, str]:
        r2_key = f'photos/{uuid.uuid4()}.webp'
        self.s3_client.put_object(
            Bucket=self.bucket_name,
            Key=r2_key,
            Body=photo.webp,
            ContentType='image/webp',
        )
        return r2_key, f'{self.public_url}/{r2_key}'

    @staticmethod
    def _insert_photos(cursor: Cursor, uploaded: list[tuple[EncodedPhoto, str, str]]) -> dict[str, int]:
        if not uploaded:
            return {}

        row = sql.SQL('({})').format(sql.SQL(', ').join([sql.Placeholder()] * 8))
        statement = sql.SQL('''
            INSERT INTO photos (md5_hash, r2_key, r2_url, format, width, height, original_size, compressed_size)
            VALUES {}
            ON CONFLICT (md5_hash) DO NOTHING
            RETURNING md5_hash, id
        ''').format(sql.SQL(', ').join([row] * len(uploaded)))

        parameters = [parameter
                      for photo, r2_key, r2_url in uploaded
                      for parameter in (photo.md5_hash, r2_key, r2_url, 'webp',
                                        photo.width, photo.height, photo.original_size, len(photo.webp))]
        cursor.execute(statement, parameters)
        return dict(cursor.fetchall())

    @staticmethod
    def _record_sources(cursor: Cursor, encoded: list[EncodedPhoto], photo_ids: dict[str, int]) -> None:
        mappings = [(photo.image_key, photo_ids[photo.md5_hash])
                    for photo in encoded if photo.md5_hash in photo_ids]
        if mappings:
            cursor.executemany(
                'INSERT INTO photo_sources (image_key, photo_id) VALUES (%s, %s) ON CONFLICT (image_key) DO NOTHING',
                mappings)

    @staticmethod
    def _compress_photo(image_data: bytes) -> tuple[bytes, int, int, int]:
        from PIL import Image
        img = Image.open(io.BytesIO(image_data))
        if img.mode in ('RGBA', 'P'):
            img = img.convert('RGB')
        width, height = img.size
        webp_buffer = io.BytesIO()
        img.save(webp_buffer, format='WebP', quality=80)
        return webp_buffer.getvalue(), width, height, len(image_data)


class PostgreSQLPipeline:

    def __init__(self, crawler: Crawler) -> None:
        self.crawler = crawler

        self.batch_size = 1000
        self.car_buffer: list[dict[str, Any]] = []
        self.car_photo_buffer: list[list[tuple[int, int]]] = []
        self.seller_buffer: list[dict[str, Any]] = []
        self.cars_inserted = 0
        self.sellers_inserted = 0

    @classmethod
    def from_crawler(cls, crawler: Crawler) -> PostgreSQLPipeline:
        return cls(crawler)

    def close_spider(self) -> None:
        """Flush any remaining items in buffers when spider finishes.

        The shared DB connection is closed later by SearchRunExtension
        (spider_closed signal fires after pipeline close_spider).
        """
        try:
            self.flush_buffers()
        except Exception as e:
            self.crawler.spider.logger.error(f'Database error: {e}', exc_info=True)
            raise

    def process_item(self, item: CarItem | SellerItem) -> CarItem | SellerItem:
        """Buffer items and flush to database in batches for better performance."""
        match item:
            case SellerItem():
                self.seller_buffer.append(dataclasses.asdict(item))
            case CarItem():
                photo_refs = item.photo_refs
                car_dict = dataclasses.asdict(item)
                car_dict.pop('screenshot', None)
                car_dict.pop('image_keys', None)
                car_dict.pop('photo_refs', None)
                self.car_buffer.append(car_dict)
                self.car_photo_buffer.append(photo_refs)

        if len(self.seller_buffer) >= self.batch_size or len(self.car_buffer) >= self.batch_size:
            self.flush_buffers()

        return item

    def flush_buffers(self) -> None:
        """Insert buffered items into the database and clear buffers. This is called when buffers reach batch size or when spider closes."""
        if not self.seller_buffer and not self.car_buffer:
            return

        search_run_id = self.crawler.stats.get_value('search_run_id')
        connection = get_shared_connection(self.crawler)
        with connection.transaction():
            with connection.cursor() as cursor:
                if self.seller_buffer:
                    insert_query = sql.SQL('''
                        INSERT INTO sellers (id, type, name, address, zip_code, city)
                        VALUES (%(id)s, %(type)s, %(name)s, %(address)s, %(zip_code)s, %(city)s)
                        ON CONFLICT (id) DO NOTHING
                    ''')

                    cursor.executemany(insert_query, self.seller_buffer)
                    self.sellers_inserted += cursor.rowcount
                    self.crawler.stats.set_value('db/sellers_inserted', self.sellers_inserted)
                    self.crawler.spider.logger.info(f'{cursor.rowcount} of {len(self.seller_buffer)} sellers inserted into database')
                    self.seller_buffer.clear()

                if self.car_buffer:
                    insert_query = sql.SQL('''
                        INSERT INTO cars(search_run_id,search_id,url,json_data,title,subtitle,description,vehicle_id,seller_vehicle_id,certification_number,price,body_type,color,mileage,has_additional_set_of_tires,had_accident,fuel_type,kilo_watts,cm3,cylinders,cylinder_layout,avg_consumption,co2_emission,warranty,leasing,created_date,last_modified_date,first_registration_date,last_inspection_date,seller_id,screenshot_id)
                        VALUES(%(search_run_id)s,%(search_id)s,%(url)s,%(json_data)s,%(title)s,%(subtitle)s,%(description)s,%(vehicle_id)s,%(seller_vehicle_id)s,%(certification_number)s,%(price)s,%(body_type)s,%(color)s,%(mileage)s,%(has_additional_set_of_tires)s,%(had_accident)s,%(fuel_type)s,%(kilo_watts)s,%(cm3)s,%(cylinders)s,%(cylinder_layout)s,%(avg_consumption)s,%(co2_emission)s,%(warranty)s,%(leasing)s,%(created_date)s,%(last_modified_date)s,%(first_registration_date)s,%(last_inspection_date)s,%(seller_id)s,%(screenshot_id)s)
                        RETURNING id
                    ''')

                    for car in self.car_buffer:
                        car['search_run_id'] = search_run_id
                        car['json_data'] = Jsonb(car['json_data'])

                    car_ids = []
                    for car in self.car_buffer:
                        cursor.execute(insert_query, car)
                        car_ids.append(cursor.fetchone()[0])

                    # Insert car_photos junction rows
                    for car_id, photo_refs in zip(car_ids, self.car_photo_buffer):
                        if photo_refs:
                            cursor.executemany(
                                'INSERT INTO car_photos (car_id, photo_id, position) VALUES (%s, %s, %s) ON CONFLICT DO NOTHING',
                                [(car_id, photo_id, position) for position, photo_id in photo_refs]
                            )

                    self.cars_inserted += len(car_ids)
                    self.crawler.stats.set_value('db/cars_inserted', self.cars_inserted)
                    self.crawler.spider.logger.info(f'{len(car_ids)} of {len(self.car_buffer)} cars inserted into database')
                    self.car_buffer.clear()
                    self.car_photo_buffer.clear()


class ItemTypeStatsPipeline:
    def __init__(self, stats: StatsCollector) -> None:
        self.stats = stats

    @classmethod
    def from_crawler(cls, crawler: Crawler) -> ItemTypeStatsPipeline:
        return cls(stats=crawler.stats)

    def process_item(self, item: CarItem | SellerItem) -> CarItem | SellerItem:
        self.stats.inc_value(f'item_scraped_count/{type(item).__name__}')
        return item
