const DEFAULT_LOCALE = 'en-US'

const formatDate = (formatter, date) =>
   formatter.format(date).replace(' ', '\u00A0') // non-breaking space


/**
 * Create locale-bound formatters.
 * On the server the locale comes from Accept-Language; on the client
 * the same value is reused via context so SSR and hydration match.
 */
export function createFormatters(locale) {
   const sd = new Intl.DateTimeFormat(locale, { year: 'numeric', month: '2-digit' })
   const md = new Intl.DateTimeFormat(locale, { year: 'numeric', month: 'short', day: 'numeric' })
   const smy = new Intl.DateTimeFormat(locale, { year: '2-digit', month: 'short' })
   const sdm = new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric' })
   const dec = new Intl.NumberFormat(locale, { style: 'decimal', minimumFractionDigits: 0, maximumFractionDigits: 0 })

   return {
      asDecimal: (number) => dec.format(number),
      asShortDate: (timestamp) => formatDate(sd, timestamp),
      asMediumDate: (timestamp) => formatDate(md, timestamp),
      asShortMonthYearDate: (timestamp) => formatDate(smy, timestamp),
      asShortDayMonthDate: (timestamp) => formatDate(sdm, timestamp),
      asTime: (timestamp) => {
         if (!timestamp) {
            return ''
         }
         return new Date(timestamp).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })
      },
   }
}


/**
 * Parse an Accept-Language header and return the preferred locale.
 * Falls back to DEFAULT_LOCALE if the header is missing or empty.
 */
export function parseAcceptLanguage(header) {
   if (!header) {
      return DEFAULT_LOCALE
   }
   const first = header.split(',')[0]
   const locale = first.split(';')[0].trim()
   return locale || DEFAULT_LOCALE
}


const BYTE_UNITS = ['B', 'KB', 'MB', 'GB', 'TB']

export function formatBytes(bytes) {
   if (!bytes) {
      return '0 B'
   }
   let i = Math.min(Math.floor(Math.log10(bytes) / 3), BYTE_UNITS.length - 1)
   if (bytes / Math.pow(1000, i) >= 999.5 && i < BYTE_UNITS.length - 1) {
      i++
   }
   const value = bytes / Math.pow(1000, i)
   return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${BYTE_UNITS[i]}`
}
