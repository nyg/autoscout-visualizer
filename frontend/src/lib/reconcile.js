export const RECONCILE_PREFIXES = ['screenshots/', 'photos/']
export const RECONCILE_GRACE_HOURS = 24

const SAMPLE_SIZE = 5

function isManagedKey(key) {
   return RECONCILE_PREFIXES.some(prefix => key.startsWith(prefix))
}

function sumSizes(rows) {
   return rows.reduce((total, row) => total + row.size, 0)
}

export function classifyImageStorage({ screenshots, photos }, objects, now = Date.now()) {
   const objectKeys = new Set(objects.map(object => object.key))
   const knownKeys = new Set()
   const dangling = { screenshots: [], photos: [] }
   const unreferenced = { screenshots: [], photos: [] }
   let unmanagedRowCount = 0
   let pendingRowCount = 0
   let databaseBytes = 0

   for (const [kind, rows] of [['screenshots', screenshots], ['photos', photos]]) {
      for (const row of rows) {
         knownKeys.add(row.r2_key)
         databaseBytes += row.size
         if (!isManagedKey(row.r2_key)) {
            unmanagedRowCount++
         } else if (!objectKeys.has(row.r2_key)) {
            dangling[kind].push(row)
         } else if (!row.referenced) {
            if (row.past_grace) {
               unreferenced[kind].push(row)
            } else {
               pendingRowCount++
            }
         }
      }
   }

   const cutoff = now - RECONCILE_GRACE_HOURS * 60 * 60 * 1000
   const orphaned = []
   let pendingObjectCount = 0
   let storageBytes = 0

   for (const object of objects) {
      storageBytes += object.size
      if (knownKeys.has(object.key)) {
         continue
      }
      if (object.lastModified < cutoff) {
         orphaned.push(object)
      } else {
         pendingObjectCount++
      }
   }

   return {
      scannedAt: now,
      graceHours: RECONCILE_GRACE_HOURS,
      storage: { objectCount: objects.length, totalBytes: storageBytes },
      database: {
         screenshotCount: screenshots.length,
         photoCount: photos.length,
         totalBytes: databaseBytes,
      },
      dangling,
      orphaned,
      unreferenced,
      skipped: { pendingObjectCount, pendingRowCount, unmanagedRowCount },
   }
}

export function summarizeReconciliation(detail) {
   const danglingRows = [...detail.dangling.screenshots, ...detail.dangling.photos]
   const unreferencedRows = [...detail.unreferenced.screenshots, ...detail.unreferenced.photos]

   return {
      scannedAt: detail.scannedAt,
      graceHours: detail.graceHours,
      storage: detail.storage,
      database: detail.database,
      skipped: detail.skipped,
      dangling: {
         screenshotCount: detail.dangling.screenshots.length,
         photoCount: detail.dangling.photos.length,
         samples: danglingRows.slice(0, SAMPLE_SIZE).map(row => row.r2_key),
      },
      orphaned: {
         count: detail.orphaned.length,
         totalBytes: detail.orphaned.reduce((total, object) => total + object.size, 0),
         samples: detail.orphaned.slice(0, SAMPLE_SIZE).map(object => object.key),
      },
      unreferenced: {
         screenshotCount: detail.unreferenced.screenshots.length,
         photoCount: detail.unreferenced.photos.length,
         totalBytes: sumSizes(unreferencedRows),
         samples: unreferencedRows.slice(0, SAMPLE_SIZE).map(row => row.r2_key),
      },
   }
}
