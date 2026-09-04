'use client'

import { CheckCircle2Icon, Loader2Icon, RefreshCwIcon, XCircleIcon } from 'lucide-react'
import { useState, useTransition } from 'react'

import {
   AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
   AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle
} from '@/components/ui/alert-dialog'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
   deleteDanglingImageRows, deleteOrphanedR2Objects, deleteUnreferencedImages, scanImageStorage
} from '@/lib/actions'
import { formatBytes } from '@/lib/format'
import { useFormatter } from '@/lib/formatter-context'


const FIXES = {
   dangling: {
      action: deleteDanglingImageRows,
      title: 'Remove dangling references?',
      confirmLabel: 'Remove rows',
   },
   orphaned: {
      action: deleteOrphanedR2Objects,
      title: 'Delete orphaned objects?',
      confirmLabel: 'Delete objects',
   },
   unreferenced: {
      action: deleteUnreferencedImages,
      title: 'Delete unreferenced images?',
      confirmLabel: 'Delete images',
   },
}

function plural(count, singular, suffix = 's') {
   return `${count} ${singular}${count !== 1 ? suffix : ''}`
}

function confirmDescription(issue, report) {
   if (!report) {
      return ''
   }
   if (issue === 'dangling') {
      return `This deletes ${plural(report.dangling.screenshotCount, 'screenshot row')} and ${plural(report.dangling.photoCount, 'photo row')} whose image is gone from storage, along with the car links that point at them. The crawler downloads those images again on its next run. This cannot be undone.`
   }
   if (issue === 'orphaned') {
      return `This permanently deletes ${plural(report.orphaned.count, 'object')} (${formatBytes(report.orphaned.totalBytes)}) from R2. No database row references them. This cannot be undone.`
   }
   return `This deletes ${plural(report.unreferenced.screenshotCount, 'screenshot')} and ${plural(report.unreferenced.photoCount, 'photo')} that no car points at, from both the database and R2, freeing ${formatBytes(report.unreferenced.totalBytes)}. This cannot be undone.`
}

function fixMessage(result) {
   if (result.issue === 'dangling') {
      return `Removed ${plural(result.removedScreenshotCount, 'screenshot row')} and ${plural(result.removedPhotoCount, 'photo row')}. The crawler will download the images again on its next run.`
   }
   const freed = result.warning ? '' : `, freeing ${formatBytes(result.freedBytes)}`
   if (result.issue === 'orphaned') {
      return `Deleted ${plural(result.removedObjectCount, 'object')} from storage${freed}.`
   }
   return `Deleted ${plural(result.removedScreenshotCount, 'screenshot')} and ${plural(result.removedPhotoCount, 'photo')}${freed}.`
}


function Issue({ title, description, count, detail, samples, remaining, actionLabel, onFix, disabled }) {
   return (
      <div className="flex items-start justify-between gap-3 rounded-md border p-3">
         <div className="flex flex-col gap-0.5">
            <div className="flex items-center gap-1.5 text-sm font-medium">
               {count === 0
                  ? <CheckCircle2Icon className="size-4 text-green-600" />
                  : <XCircleIcon className="size-4 text-destructive" />
               }
               {title}
            </div>
            <p className="text-sm text-muted-foreground">{description}</p>
            {count === 0
               ? <p className="text-sm text-green-600">None found.</p>
               : <p className="text-sm">{detail}</p>
            }
            {samples.length > 0 && (
               <ul className="mt-1 flex flex-col gap-0.5">
                  {samples.map(key => (
                     <li key={key} className="font-mono text-xs text-muted-foreground">{key}</li>
                  ))}
                  {remaining > 0 && (
                     <li className="text-xs text-muted-foreground">and {remaining} more…</li>
                  )}
               </ul>
            )}
         </div>
         {count > 0 && (
            <button
               onClick={onFix}
               disabled={disabled}
               className="shrink-0 rounded-md border border-destructive/30 px-3 py-1 text-sm text-destructive transition-colors hover:bg-destructive/10 disabled:opacity-50"
            >
               {actionLabel}
            </button>
         )}
      </div>
   )
}


export default function StorageReconciliation() {
   const [report, setReport] = useState(null)
   const [error, setError] = useState(null)
   const [result, setResult] = useState(null)
   const [confirming, setConfirming] = useState(null)
   const [pending, startTransition] = useTransition()
   const { asTime } = useFormatter()

   const runScan = () => {
      setError(null)
      setResult(null)
      startTransition(async () => {
         const response = await scanImageStorage()
         if (response.error) {
            setError(response.error)
            setReport(null)
         } else {
            setReport(response.report)
         }
      })
   }

   const runFix = () => {
      const issue = confirming
      setConfirming(null)
      setError(null)
      setResult(null)
      startTransition(async () => {
         const response = await FIXES[issue].action()
         if (response.error) {
            setError(response.error)
            return
         }
         setResult({ issue, ...response })
         const rescan = await scanImageStorage()
         if (!rescan.error) {
            setReport(rescan.report)
         }
      })
   }

   const inSync = report
      && report.dangling.screenshotCount === 0 && report.dangling.photoCount === 0
      && report.orphaned.count === 0
      && report.unreferenced.screenshotCount === 0 && report.unreferenced.photoCount === 0

   return (
      <Card>
         <CardHeader>
            <CardTitle>Image Storage Reconciliation</CardTitle>
         </CardHeader>
         <CardContent className="flex flex-col gap-4">
            <p className="text-sm text-muted-foreground">
               Compares the <code className="text-xs">screenshots</code> and <code className="text-xs">photos</code> tables
               against the <code className="text-xs">screenshots/</code> and <code className="text-xs">photos/</code> prefixes
               in R2, and offers to resolve whatever the two disagree on.
            </p>

            <div className="flex items-center gap-3 flex-wrap">
               <button
                  onClick={runScan}
                  disabled={pending}
                  className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1 text-sm transition-colors hover:bg-muted disabled:opacity-50"
               >
                  {pending
                     ? <Loader2Icon className="size-3.5 animate-spin" />
                     : <RefreshCwIcon className="size-3.5" />
                  }
                  {report ? 'Scan again' : 'Scan'}
               </button>
               {report && (
                  <span className="text-sm text-muted-foreground">
                     {plural(report.storage.objectCount, 'object')} in R2 ({formatBytes(report.storage.totalBytes)})
                     {' · '}
                     {plural(report.database.screenshotCount, 'screenshot')} and {plural(report.database.photoCount, 'photo')} in the database ({formatBytes(report.database.totalBytes)})
                     {' · '}
                     scanned at {asTime(report.scannedAt)}
                  </span>
               )}
            </div>

            {error && <p className="text-sm text-destructive">{error}</p>}

            {result && (
               <div className="flex flex-col gap-1">
                  <p className="text-sm text-green-600">{fixMessage(result)}</p>
                  {result.warning && (
                     <p className="text-sm text-destructive">
                        {result.warning} They are orphaned in storage and must be removed manually.
                     </p>
                  )}
               </div>
            )}

            {report && (
               <div className="flex flex-col gap-2">
                  {inSync && (
                     <p className="text-sm text-green-600">The database and R2 agree on every image.</p>
                  )}

                  <Issue
                     title="Missing in storage"
                     description="Rows whose R2 object is gone, so the image is broken everywhere it is shown."
                     count={report.dangling.screenshotCount + report.dangling.photoCount}
                     detail={`${plural(report.dangling.screenshotCount, 'screenshot')} and ${plural(report.dangling.photoCount, 'photo')} reference an object that does not exist.`}
                     samples={report.dangling.samples}
                     remaining={report.dangling.screenshotCount + report.dangling.photoCount - report.dangling.samples.length}
                     actionLabel="Remove rows"
                     onFix={() => setConfirming('dangling')}
                     disabled={pending}
                  />

                  <Issue
                     title="Orphaned in storage"
                     description="Objects in R2 that no database row points at — paid-for storage nothing can reach."
                     count={report.orphaned.count}
                     detail={`${plural(report.orphaned.count, 'object')} taking ${formatBytes(report.orphaned.totalBytes)}.`}
                     samples={report.orphaned.samples}
                     remaining={report.orphaned.count - report.orphaned.samples.length}
                     actionLabel="Delete objects"
                     onFix={() => setConfirming('orphaned')}
                     disabled={pending}
                  />

                  <Issue
                     title="Unreferenced images"
                     description="Rows and their objects that no car links to any more, left behind by earlier deletions."
                     count={report.unreferenced.screenshotCount + report.unreferenced.photoCount}
                     detail={`${plural(report.unreferenced.screenshotCount, 'screenshot')} and ${plural(report.unreferenced.photoCount, 'photo')} taking ${formatBytes(report.unreferenced.totalBytes)}.`}
                     samples={report.unreferenced.samples}
                     remaining={report.unreferenced.screenshotCount + report.unreferenced.photoCount - report.unreferenced.samples.length}
                     actionLabel="Delete images"
                     onFix={() => setConfirming('unreferenced')}
                     disabled={pending}
                  />

                  {(report.skipped.pendingObjectCount > 0 || report.skipped.pendingRowCount > 0) && (
                     <p className="text-xs text-muted-foreground">
                        Held back as too recent to judge: {plural(report.skipped.pendingObjectCount, 'object')} and
                        {' '}{plural(report.skipped.pendingRowCount, 'row')} younger than {report.graceHours} hours.
                        A crawl uploads an image before it writes the row, so anything that new may belong to a run in progress.
                     </p>
                  )}
                  {report.skipped.unmanagedRowCount > 0 && (
                     <p className="text-xs text-muted-foreground">
                        {plural(report.skipped.unmanagedRowCount, 'row')} stored outside
                        the <code>screenshots/</code> and <code>photos/</code> prefixes were not checked.
                     </p>
                  )}
               </div>
            )}

            <AlertDialog open={confirming !== null} onOpenChange={open => !open && setConfirming(null)}>
               <AlertDialogContent size="sm">
                  <AlertDialogHeader>
                     <AlertDialogTitle>{confirming ? FIXES[confirming].title : ''}</AlertDialogTitle>
                     <AlertDialogDescription>
                        {confirmDescription(confirming, report)}
                     </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                     <AlertDialogCancel>Cancel</AlertDialogCancel>
                     <AlertDialogAction variant="destructive" onClick={runFix}>
                        {confirming ? FIXES[confirming].confirmLabel : ''}
                     </AlertDialogAction>
                  </AlertDialogFooter>
               </AlertDialogContent>
            </AlertDialog>
         </CardContent>
      </Card>
   )
}
