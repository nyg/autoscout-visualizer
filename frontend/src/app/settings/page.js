import { Suspense } from 'react'

import ClientSettings from '@/components/client-settings'
import ImageStorage from '@/components/image-storage'
import SearchManager from '@/components/search-manager'
import StorageReconciliation from '@/components/storage-reconciliation'
import {
   fetchConfig, fetchPhotoStorageByDay, fetchPhotoStorageSummary,
   fetchScreenshotStorageByDay, fetchScreenshotStorageSummary, fetchSearches
} from '@/lib/data'

export default async function SettingsPage() {
   const searches = await fetchSearches()
   const config = await fetchConfig()
   const screenshotData = fetchScreenshotStorageByDay()
   const screenshotSummary = fetchScreenshotStorageSummary()
   const photoData = fetchPhotoStorageByDay()
   const photoSummary = fetchPhotoStorageSummary()

   return (
      <div className="mx-auto flex max-w-screen-xl flex-col gap-4 px-4">
         <SearchManager searches={searches} />
         <ClientSettings config={config} />
         <Suspense fallback={<p className="text-sm text-muted-foreground">Loading storage data…</p>}>
            <ImageStorage
               screenshotData={screenshotData}
               screenshotSummary={screenshotSummary}
               photoData={photoData}
               photoSummary={photoSummary}
            />
         </Suspense>
         <StorageReconciliation />
      </div>
   )
}
