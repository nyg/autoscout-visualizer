'use client'

import { ArrowDownIcon, ArrowUpIcon, CheckIcon, CopyIcon } from 'lucide-react'
import { useActionState, useState, useTransition } from 'react'

import {
   AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
   AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle
} from '@/components/ui/alert-dialog'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
   createSearch, deleteSearch, toggleSearchActive, toggleSearchPhotos, toggleSearchScreenshots, updateSearch
} from '@/lib/actions'
import { useFormatter } from '@/lib/formatter-context'



function CopyUrlButton({ url }) {
   const [copied, setCopied] = useState(false)

   const handleCopy = async () => {
      try {
         await navigator.clipboard.writeText(url)
         setCopied(true)
         setTimeout(() => setCopied(false), 1500)
      } catch { /* ignore */ }
   }

   return (
      <button
         onClick={handleCopy}
         className="shrink-0 text-muted-foreground hover:text-foreground transition-colors"
         title="Copy URL"
         aria-label="Copy URL to clipboard"
      >
         {copied
            ? <CheckIcon className="size-3.5 text-green-600" />
            : <CopyIcon className="size-3.5" />
         }
      </button>
   )
}

function SearchRow({ search }) {
   const { asBytes, asDecimal } = useFormatter()
   const [editing, setEditing] = useState(false)
   const [, submitUpdate, updatingPending] = useActionState(async (prev, formData) => {
      const result = await updateSearch(prev, formData)
      if (result.success) {
         setEditing(false)
      }
      return result
   }, null)
   const [, submitToggle] = useActionState(toggleSearchActive, null)
   const [, submitToggleScreenshots] = useActionState(toggleSearchScreenshots, null)
   const [, submitTogglePhotos] = useActionState(toggleSearchPhotos, null)

   const [dialogOpen, setDialogOpen] = useState(false)
   const [deleteInfo, setDeleteInfo] = useState(null)
   const [deletePending, startDeleteTransition] = useTransition()
   const [deleteError, setDeleteError] = useState(null)
   const [deleteWarning, setDeleteWarning] = useState(null)

   const handleDelete = () => {
      setDeleteError(null)
      const formData = new FormData()
      formData.set('id', String(search.id))
      startDeleteTransition(async () => {
         const result = await deleteSearch(null, formData)
         if (result?.needsConfirm) {
            setDeleteInfo(result)
            setDialogOpen(true)
         } else if (result?.error) {
            setDeleteError(result.error)
         }
      })
   }

   const handleConfirmDelete = () => {
      const formData = new FormData()
      formData.set('id', String(search.id))
      formData.set('confirmed', 'true')
      startDeleteTransition(async () => {
         const result = await deleteSearch(null, formData)
         if (result?.error) {
            setDeleteError(result.error)
         }
         // The row disappears on success, so an R2 warning has to be shown in
         // the dialog — keep it open rather than losing the message.
         if (result?.warning) {
            setDeleteWarning(result.warning)
         } else {
            setDialogOpen(false)
         }
      })
   }

   if (editing) {
      return (
         <tr className="border-b">
            <td colSpan={11} className="p-2">
               <form action={submitUpdate} className="flex flex-col gap-2">
                  <input type="hidden" name="id" value={search.id} />
                  <input type="hidden" name="is_active" value={String(search.is_active)} />
                  <input type="hidden" name="screenshots_enabled" value={String(search.screenshots_enabled)} />
                  <input type="hidden" name="photos_enabled" value={String(search.photos_enabled)} />
                  <input
                     name="name"
                     defaultValue={search.name}
                     placeholder="Search name"
                     className="rounded-md border bg-background px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-ring"
                  />
                  <input
                     name="url"
                     defaultValue={search.url}
                     placeholder="AutoScout24 URL"
                     className="rounded-md border bg-background px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-ring"
                  />
                  <div className="flex gap-2 justify-end">
                     <button
                        type="button"
                        onClick={() => setEditing(false)}
                        className="rounded-md border px-3 py-1 text-xs transition-colors hover:bg-muted"
                     >
                        Cancel
                     </button>
                     <button
                        type="submit"
                        disabled={updatingPending}
                        className="rounded-md bg-primary px-3 py-1 text-xs font-medium text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
                     >
                        {updatingPending ? 'Saving…' : 'Save'}
                     </button>
                  </div>
               </form>
            </td>
         </tr>
      )
   }

   return (
      <tr className="border-b text-sm font-medium">
         <td className="p-2 text-right tabular-nums text-muted-foreground whitespace-nowrap">{search.id}</td>
         <td className="p-2 whitespace-nowrap">{search.name}</td>
         <td className="p-2 text-muted-foreground max-w-0 w-full" title={search.url}>
            <span className="flex items-center gap-1.5 min-w-0">
               <a
                  href={search.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="truncate hover:text-foreground hover:underline transition-colors"
               >
                  {search.url}
               </a>
               <CopyUrlButton url={search.url} />
            </span>
         </td>
         <td className="p-2 text-right text-muted-foreground whitespace-nowrap">{asDecimal(search.run_count)}</td>
         <td className="p-2 text-right text-muted-foreground whitespace-nowrap">{asDecimal(search.car_count)}</td>
         <td className="p-2 text-right text-muted-foreground whitespace-nowrap">
            {asDecimal(search.screenshot_count)}
            {search.screenshot_size > 0 && (
               <span className="text-xs ml-1">({asBytes(search.screenshot_size)})</span>
            )}
         </td>
         <td className="p-2 text-right text-muted-foreground whitespace-nowrap">
            {asDecimal(search.photo_count)}
            {search.photo_size > 0 && (
               <span className="text-xs ml-1">({asBytes(search.photo_size)})</span>
            )}
         </td>
         <td className="p-2 text-center whitespace-nowrap">
            <form action={submitToggle} className="inline">
               <input type="hidden" name="id" value={search.id} />
               <input type="hidden" name="is_active" value={String(!search.is_active)} />
               <button
                  type="submit"
                  className={`inline-flex size-4 items-center justify-center rounded-sm border text-xs transition-colors ${
                     search.is_active
                        ? 'border-primary bg-primary text-primary-foreground'
                        : 'border-muted-foreground/30'
                  }`}
                  title={search.is_active ? 'Active — click to deactivate' : 'Inactive — click to activate'}
               >
                  {search.is_active ? '✓' : ''}
               </button>
            </form>
         </td>
         <td className="p-2 text-center whitespace-nowrap">
            <form action={submitToggleScreenshots} className="inline">
               <input type="hidden" name="id" value={search.id} />
               <input type="hidden" name="screenshots_enabled" value={String(!search.screenshots_enabled)} />
               <button
                  type="submit"
                  className={`inline-flex size-4 items-center justify-center rounded-sm border text-xs transition-colors ${
                     search.screenshots_enabled
                        ? 'border-primary bg-primary text-primary-foreground'
                        : 'border-muted-foreground/30'
                  }`}
                  title={search.screenshots_enabled ? 'Page screenshots on — click to disable' : 'Page screenshots off — click to enable'}
               >
                  {search.screenshots_enabled ? '✓' : ''}
               </button>
            </form>
         </td>
         <td className="p-2 text-center whitespace-nowrap">
            <form action={submitTogglePhotos} className="inline">
               <input type="hidden" name="id" value={search.id} />
               <input type="hidden" name="photos_enabled" value={String(!search.photos_enabled)} />
               <button
                  type="submit"
                  className={`inline-flex size-4 items-center justify-center rounded-sm border text-xs transition-colors ${
                     search.photos_enabled
                        ? 'border-primary bg-primary text-primary-foreground'
                        : 'border-muted-foreground/30'
                  }`}
                  title={search.photos_enabled ? 'Listing photos on — click to disable' : 'Listing photos off — click to enable'}
               >
                  {search.photos_enabled ? '✓' : ''}
               </button>
            </form>
         </td>
         <td className="p-2 text-right whitespace-nowrap">
            <div className="flex gap-1 justify-end items-center">
               <button
                  onClick={() => setEditing(true)}
                  className="rounded-md border px-2 py-0.5 text-xs transition-colors hover:bg-muted"
               >
                  Edit
               </button>
               <button
                  onClick={handleDelete}
                  disabled={deletePending}
                  className="rounded-md border border-destructive/30 px-2 py-0.5 text-xs text-destructive transition-colors hover:bg-destructive/10 disabled:opacity-50"
               >
                  {deletePending && !dialogOpen ? '…' : 'Delete'}
               </button>
               {deleteError && (
                  <span className="text-xs text-destructive">{deleteError}</span>
               )}
               <AlertDialog open={dialogOpen} onOpenChange={setDialogOpen}>
                  <AlertDialogContent size="sm">
                     <AlertDialogHeader>
                        <AlertDialogTitle>
                           {deleteWarning ? 'Deleted, with a problem' : <>Delete &ldquo;{search.name}&rdquo;?</>}
                        </AlertDialogTitle>
                        <AlertDialogDescription>
                           {deleteWarning ? (
                              `The database entries were deleted, but ${deleteWarning}`
                           ) : (
                              <>
                                 This will permanently delete {deleteInfo?.runCount} run{deleteInfo?.runCount !== 1 ? 's' : ''},
                                 {' '}{deleteInfo?.carCount} car{deleteInfo?.carCount !== 1 ? 's' : ''}
                                 {deleteInfo?.screenshotCount > 0 && `, ${deleteInfo?.screenshotCount} screenshot${deleteInfo?.screenshotCount !== 1 ? 's' : ''}`}
                                 {deleteInfo?.photoCount > 0 && `, ${deleteInfo?.photoCount} photo${deleteInfo?.photoCount !== 1 ? 's' : ''}`}.
                                 This action cannot be undone.
                              </>
                           )}
                        </AlertDialogDescription>
                     </AlertDialogHeader>
                     <AlertDialogFooter>
                        {deleteWarning ? (
                           <AlertDialogCancel onClick={() => setDeleteWarning(null)}>Close</AlertDialogCancel>
                        ) : (
                           <>
                              <AlertDialogCancel disabled={deletePending}>Cancel</AlertDialogCancel>
                              <AlertDialogAction variant="destructive" disabled={deletePending} onClick={handleConfirmDelete}>
                                 {deletePending ? 'Deleting…' : 'Delete'}
                              </AlertDialogAction>
                           </>
                        )}
                     </AlertDialogFooter>
                  </AlertDialogContent>
               </AlertDialog>
            </div>
         </td>
      </tr>
   )
}

function AddSearchForm() {
   const [state, submitAction, pending] = useActionState(createSearch, null)

   return (
      <form action={submitAction} className="flex flex-col gap-2">
         <p className="text-sm font-medium">Add new search</p>
         <input
            name="name"
            placeholder="Search name (e.g. Audi RS6 Avant)"
            required
            className="rounded-md border bg-background px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-ring"
         />
         <input
            name="url"
            placeholder="AutoScout24 search URL"
            required
            className="rounded-md border bg-background px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-ring"
         />
         {state?.error && (
            <p className="text-xs text-destructive">{state.error}</p>
         )}
         <button
            type="submit"
            disabled={pending}
            className="self-end rounded-md bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
         >
            {pending ? 'Adding…' : 'Add search'}
         </button>
      </form>
   )
}

const SORT_COLUMNS = [
   { key: 'id', field: 'id', numeric: true },
   { key: 'name', field: 'name', numeric: false },
   { key: 'run_count', field: 'run_count', numeric: true },
   { key: 'car_count', field: 'car_count', numeric: true },
   { key: 'screenshot_count', field: 'screenshot_count', numeric: true },
   { key: 'photo_count', field: 'photo_count', numeric: true },
]

function sortSearches(searches, key, dir) {
   if (!key) {
      return searches
   }
   const col = SORT_COLUMNS.find(c => c.key === key)
   if (!col) {
      return searches
   }
   return [...searches].sort((a, b) => {
      const av = a[col.field] ?? (col.numeric ? 0 : '')
      const bv = b[col.field] ?? (col.numeric ? 0 : '')
      const cmp = col.numeric ? av - bv : av.localeCompare(bv)
      return dir === 'asc' ? cmp : -cmp
   })
}

function SortableTh({ colKey, align = 'left', sort, onSort, children }) {
   return (
      <th
         className={`p-2 whitespace-nowrap cursor-pointer select-none hover:text-foreground transition-colors ${align === 'right' ? 'text-right' : ''}`}
         onClick={() => onSort(colKey)}
      >
         {children}
         {sort.key === colKey && (
            sort.dir === 'asc'
               ? <ArrowUpIcon className="inline size-3 ml-0.5" />
               : <ArrowDownIcon className="inline size-3 ml-0.5" />
         )}
      </th>
   )
}

export default function SearchManager({ searches }) {
   const [sort, setSort] = useState({ key: 'name', dir: 'asc' })

   const handleSort = (key) => {
      setSort(prev => ({
         key,
         dir: prev.key === key && prev.dir === 'asc' ? 'desc' : 'asc',
      }))
   }

   const sorted = sortSearches(searches, sort.key, sort.dir)
   return (
      <Card>
         <CardHeader>
            <CardTitle>Searches</CardTitle>
         </CardHeader>
         <CardContent className="flex flex-col gap-4">
            <p className="text-sm text-muted-foreground">
               Manage your AutoScout24 search configurations. Active searches will be crawled on the next scheduled run.
            </p>
            {searches.length > 0 ? (
               <table className="w-full text-left">
                  <thead>
                     <tr className="border-b text-xs font-medium text-muted-foreground">
                        <SortableTh colKey="id" align="right" sort={sort} onSort={handleSort}>ID</SortableTh>
                        <SortableTh colKey="name" sort={sort} onSort={handleSort}>Name</SortableTh>
                        <th className="p-2 w-full">URL</th>
                        <SortableTh colKey="run_count" align="right" sort={sort} onSort={handleSort}>Runs</SortableTh>
                        <SortableTh colKey="car_count" align="right" sort={sort} onSort={handleSort}>Cars</SortableTh>
                        <SortableTh colKey="screenshot_count" align="right" sort={sort} onSort={handleSort}>Screenshots</SortableTh>
                        <SortableTh colKey="photo_count" align="right" sort={sort} onSort={handleSort}>Photos</SortableTh>
                        <th className="p-2 text-center whitespace-nowrap">Active</th>
                        <th className="p-2 text-center whitespace-nowrap">Screenshot</th>
                        <th className="p-2 text-center whitespace-nowrap">Photos</th>
                        <th className="p-2 text-center whitespace-nowrap">Actions</th>
                     </tr>
                  </thead>
                  <tbody>
                     {sorted.map(search => (
                        <SearchRow key={search.id} search={search} />
                     ))}
                  </tbody>
               </table>
            ) : (
               <p className="text-sm text-muted-foreground">No searches configured yet.</p>
            )}
            <AddSearchForm />
         </CardContent>
      </Card>
   )
}
