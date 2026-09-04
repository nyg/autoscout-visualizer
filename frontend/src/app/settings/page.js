import { Suspense } from 'react'

import ClientSettings from '@/components/client-settings'
import ScreenshotStorage from '@/components/screenshot-storage'
import SearchManager from '@/components/search-manager'
import StorageReconciliation from '@/components/storage-reconciliation'
import {
   fetchConfig, fetchScreenshotStorageByDay,
   fetchScreenshotStorageSummary, fetchSearches
} from '@/lib/data'

export default async function SettingsPage() {
   const searches = await fetchSearches()
   const config = await fetchConfig()
   const screenshotData = fetchScreenshotStorageByDay()
   const screenshotSummary = fetchScreenshotStorageSummary()

   return (
      <div className="mx-auto flex max-w-screen-xl flex-col gap-4 px-4">
         <SearchManager searches={searches} />
         <ClientSettings config={config} />
         <Suspense fallback={<p className="text-sm text-muted-foreground">Loading screenshot data…</p>}>
            <ScreenshotStorage data={screenshotData} summary={screenshotSummary} />
         </Suspense>
         <StorageReconciliation />
      </div>
   )
}
