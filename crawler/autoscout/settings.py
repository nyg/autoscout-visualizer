import logging
import platform

from dotenv import load_dotenv

load_dotenv()
logging.getLogger('njsparser').setLevel(logging.ERROR)
logging.getLogger('scrapy_seleniumbase_cdp').setLevel(logging.DEBUG)

BOT_NAME = 'autoscout'

SPIDER_MODULES = ['autoscout.spiders']
NEWSPIDER_MODULE = 'autoscout.spiders'

ADDONS = {}
ROBOTSTXT_OBEY = False
CONCURRENT_REQUESTS = 1
DOWNLOAD_DELAY = 5
RETRY_TIMES = 3
COOKIES_ENABLED = True
TELNETCONSOLE_ENABLED = False
LOG_LEVEL = 'INFO'
TWISTED_REACTOR = 'twisted.internet.asyncioreactor.AsyncioSelectorReactor'
RETRY_HTTP_CODES = [500, 502, 503, 504, 522, 524, 408, 429, 403] # adding 403

PGSQL_CONNECT_TIMEOUT = 1
PHOTO_WORKERS = 8

is_linux_aarch64 = platform.system() == 'Linux' and platform.machine() == 'aarch64'

screen_resolution = '1026,720'
SELENIUMBASE_BROWSER_OPTIONS = {
    'ad_block': True,
    'use_chromium': not is_linux_aarch64, # not supported by SeleniumBase
    'xvfb_metrics': screen_resolution,
    'browser_args': [
        # '--disable-features=Translate',
        # This option doesn't work on Linux with Xvfb (https://issues.chromium.org/issues/429137221).
        # Create /etc/chromium/policies/managed/disable_translate.json with content: { "TranslateEnabled": false } instead.
        # '--start-maximized',
        # Doesn't work either on Linux with Xvfb. Using window-position and window-size instead.
        '--window-position=0,0',
        f'--window-size={screen_resolution}'],
}

DOWNLOADER_MIDDLEWARES = {
    'scrapy_seleniumbase_cdp.SeleniumBaseAsyncCDPMiddleware': 800
}

EXTENSIONS = {
    'scrapy.extensions.logstats.LogStats': None,
    'autoscout.extensions.SearchRunExtension': 500,
}

ITEM_PIPELINES = {
    'autoscout.pipelines.ItemTypeStatsPipeline': 200,
    'autoscout.pipelines.ScreenshotPipeline': 250,
    'autoscout.pipelines.PhotoPipeline': 260,
    'autoscout.pipelines.PostgreSQLPipeline': 300,
}
