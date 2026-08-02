'use client'

import {
   BarChartIcon, CheckCircle2Icon, ChevronDownIcon, ChevronLeftIcon,
   ChevronRightIcon, FilterIcon, RefreshCwIcon, Trash2Icon, XCircleIcon
} from 'lucide-react'
import { useRouter } from 'next/navigation'
import { use, useEffect, useRef, useState, useTransition } from 'react'

import {
   AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
   AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Card, CardAction, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
   DropdownMenu, DropdownMenuContent, DropdownMenuGroup,
   DropdownMenuItem, DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
   Table, TableBody, TableCell, TableHead, TableHeader, TableRow
} from '@/components/ui/table'
import { deleteSearchRun } from '@/lib/actions'
import { useFormatter } from '@/lib/formatter-context'


const PAGE_SIZES = [10, 20, 50, 100]

const PREFS_KEY = 'search-runs-preferences'

function savePreferences(prefs) {
   try {
      localStorage.setItem(PREFS_KEY, JSON.stringify(prefs))
   } catch { /* ignore */ }
}

function loadPreferences() {
   try {
      const raw = localStorage.getItem(PREFS_KEY)
      return raw ? JSON.parse(raw) : null
   } catch {
      return null
   }
}

function formatDuration(start, end) {
   if (!start || !end) {
      return '–'
   }
   const ms = new Date(end) - new Date(start)
   const totalSeconds = Math.floor(ms / 1000)
   const minutes = Math.floor(totalSeconds / 60)
   const seconds = totalSeconds % 60
   return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`
}

function buildUrl(params) {
   const sp = new URLSearchParams()
   if (params.search) {
      sp.set('search', params.search)
   }
   if (params.page && params.page > 1) {
      sp.set('page', String(params.page))
   }
   if (params.pageSize && params.pageSize !== 20) {
      sp.set('pageSize', String(params.pageSize))
   }
   if (params.from) {
      sp.set('from', params.from)
   }
   if (params.to) {
      sp.set('to', params.to)
   }
   const qs = sp.toString()
   return `/search-runs${qs ? `?${qs}` : ''}`
}

function StatsPopover({ stats }) {
   if (!stats || Object.keys(stats).length === 0) {
      return (
         <span className="text-muted-foreground/40 inline-flex">
            <BarChartIcon className="size-4" />
         </span>
      )
   }

   return (
      <Popover>
         <PopoverTrigger className="text-muted-foreground hover:text-foreground transition-colors inline-flex cursor-pointer">
            <BarChartIcon className="size-4" />
         </PopoverTrigger>
         <PopoverContent align="end" className="w-96 max-h-80 overflow-auto p-3">
            <pre className="text-xs leading-relaxed whitespace-pre-wrap break-all">
               {JSON.stringify(stats, null, 2)}
            </pre>
         </PopoverContent>
      </Popover>
   )
}

function DeleteRunCell({ runId }) {
   const [dialogOpen, setDialogOpen] = useState(false)
   const [info, setInfo] = useState(null)
   const [isPending, startTransition] = useTransition()
   const [error, setError] = useState(null)
   const [warning, setWarning] = useState(null)

   const handleDelete = () => {
      setError(null)
      const formData = new FormData()
      formData.set('id', String(runId))
      startTransition(async () => {
         const result = await deleteSearchRun(null, formData)
         if (result?.needsConfirm) {
            setInfo(result)
            setDialogOpen(true)
         } else if (result?.error) {
            setError(result.error)
         }
      })
   }

   const handleConfirm = () => {
      const formData = new FormData()
      formData.set('id', String(runId))
      formData.set('confirmed', 'true')
      startTransition(async () => {
         const result = await deleteSearchRun(null, formData)
         if (result?.error) {
            setError(result.error)
         }
         // The row disappears on success, so an R2 warning has to be shown in
         // the dialog — keep it open rather than losing the message.
         if (result?.warning) {
            setWarning(result.warning)
         } else {
            setDialogOpen(false)
         }
      })
   }

   return (
      <>
         {error && <span className="text-xs text-destructive mr-1">{error}</span>}
         <button
            type="button"
            onClick={handleDelete}
            disabled={isPending}
            className="text-muted-foreground hover:text-destructive transition-colors disabled:opacity-50"
            title="Delete search run"
            aria-label="Delete search run"
         >
            <Trash2Icon className="size-4" />
         </button>
         <AlertDialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <AlertDialogContent size="sm">
               <AlertDialogHeader>
                  <AlertDialogTitle>{warning ? 'Deleted, with a problem' : 'Delete search run?'}</AlertDialogTitle>
                  <AlertDialogDescription>
                     {warning ? (
                        `The database entries were deleted, but ${warning}`
                     ) : (
                        <>
                           This will permanently delete {info?.carCount} car{info?.carCount !== 1 ? 's' : ''}
                           {info?.screenshotCount > 0 && ` and ${info?.screenshotCount} screenshot${info?.screenshotCount !== 1 ? 's' : ''}`}.
                           This action cannot be undone.
                        </>
                     )}
                  </AlertDialogDescription>
               </AlertDialogHeader>
               <AlertDialogFooter>
                  {warning ? (
                     <AlertDialogCancel onClick={() => setWarning(null)}>Close</AlertDialogCancel>
                  ) : (
                     <>
                        <AlertDialogCancel disabled={isPending}>Cancel</AlertDialogCancel>
                        <AlertDialogAction variant="destructive" disabled={isPending} onClick={handleConfirm}>
                           {isPending ? 'Deleting…' : 'Delete'}
                        </AlertDialogAction>
                     </>
                  )}
               </AlertDialogFooter>
            </AlertDialogContent>
         </AlertDialog>
      </>

   )
}


export default function SearchRuns({ data, searches, totalCount, page, pageSize, searchFilter, fromDate, toDate, hasExplicitParams }) {

   const runs = use(data)
   const searchList = use(searches)
   const total = use(totalCount)
   const router = useRouter()

   const {asMediumDate, asTime} = useFormatter()

   const totalPages = Math.max(1, Math.ceil(total / pageSize))

   const [localFrom, setLocalFrom] = useState(fromDate)
   const [localTo, setLocalTo] = useState(toDate)

   // Restore saved preferences on first visit (bare URL with no explicit params)
   const didRestore = useRef(false)
   useEffect(() => {
      if (didRestore.current || hasExplicitParams) {
         return
      }
      didRestore.current = true
      const prefs = loadPreferences()
      if (!prefs) {
         return
      }
      const url = buildUrl({
         search: prefs.search ?? null,
         page: 1,
         pageSize: prefs.pageSize ?? 20,
         from: prefs.from ?? fromDate,
         to: prefs.to ?? toDate,
      })
      if (url !== window.location.pathname + window.location.search) {
         window.location.href = url
      }
   }, [hasExplicitParams, fromDate, toDate])

   const navigate = (params) => {
      const resolved = {
         search: params.search ?? searchFilter,
         page: params.page ?? page,
         pageSize: params.pageSize ?? pageSize,
         from: params.from ?? localFrom,
         to: params.to ?? localTo,
      }
      savePreferences({
         search: resolved.search,
         pageSize: resolved.pageSize,
         from: resolved.from,
         to: resolved.to,
      })
      window.location.href = buildUrl(resolved)
   }

   const applyDateRange = () => {
      navigate({ page: 1, from: localFrom, to: localTo })
   }

   return (
      <Card>
         <CardHeader>
            <CardTitle>Search Runs ({total})</CardTitle>
            <CardAction className="flex items-center gap-2 flex-wrap">
               {/* Refresh */}
               <Button variant="outline" size="sm" onClick={() => router.refresh()}>
                  <RefreshCwIcon className="size-3.5" />
               </Button>

               {/* Search filter */}
               <DropdownMenu>
                  <DropdownMenuTrigger render={<Button variant="outline" size="sm" />}>
                     <FilterIcon className="size-3.5" />
                     {searchFilter ?? 'All searches'}
                     <ChevronDownIcon data-icon="inline-end" />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                     <DropdownMenuGroup>
                        <DropdownMenuItem
                           onClick={() => navigate({ search: null, page: 1 })}
                           className={!searchFilter ? 'font-semibold' : ''}
                        >
                           All searches
                        </DropdownMenuItem>
                        {searchList.map(s => (
                           <DropdownMenuItem
                              key={s.id}
                              onClick={() => navigate({ search: s.name, page: 1 })}
                              className={searchFilter === s.name ? 'font-semibold' : ''}
                           >
                              {s.name}
                           </DropdownMenuItem>
                        ))}
                     </DropdownMenuGroup>
                  </DropdownMenuContent>
               </DropdownMenu>

               {/* Page size */}
               <DropdownMenu>
                  <DropdownMenuTrigger render={<Button variant="outline" size="sm" />}>
                     {pageSize}
                     <ChevronDownIcon data-icon="inline-end" />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                     <DropdownMenuGroup>
                        {PAGE_SIZES.map(size => (
                           <DropdownMenuItem
                              key={size}
                              onClick={() => navigate({ pageSize: size, page: 1 })}
                              className={pageSize === size ? 'font-semibold' : ''}
                           >
                              {size} per page
                           </DropdownMenuItem>
                        ))}
                     </DropdownMenuGroup>
                  </DropdownMenuContent>
               </DropdownMenu>
            </CardAction>
         </CardHeader>

         {/* Date range filter */}
         <div className="flex items-center gap-2 px-6 pb-4 flex-wrap">
            <label className="text-xs text-muted-foreground">From</label>
            <input
               type="date"
               value={localFrom}
               onChange={e => setLocalFrom(e.target.value)}
               className="rounded-md border bg-background px-2 py-1 text-sm outline-none focus:ring-2 focus:ring-ring"
            />
            <label className="text-xs text-muted-foreground">To</label>
            <input
               type="date"
               value={localTo}
               onChange={e => setLocalTo(e.target.value)}
               className="rounded-md border bg-background px-2 py-1 text-sm outline-none focus:ring-2 focus:ring-ring"
            />
            <Button variant="outline" size="sm" onClick={applyDateRange}>
               Apply
            </Button>
         </div>

         <CardContent className="overflow-x-auto px-0 pb-0">
            <Table>
               <TableHeader>
                  <TableRow>
                     <TableHead>Search</TableHead>
                     <TableHead className="text-right">Date</TableHead>
                     <TableHead className="text-right">Duration</TableHead>
                     <TableHead className="text-center">Status</TableHead>
                     <TableHead className="text-right">Cars found</TableHead>
                     <TableHead className="text-right">Cars scraped</TableHead>
                     <TableHead className="text-right">Requests</TableHead>
                     <TableHead className="text-right">Failed</TableHead>
                     <TableHead className="text-center">Stats</TableHead>
                     <TableHead className="w-0"></TableHead>
                  </TableRow>
               </TableHeader>
               <TableBody>
                  {runs.length === 0 && (
                     <TableRow>
                        <TableCell colSpan={11} className="text-center text-muted-foreground">
                           No search runs found.
                        </TableCell>
                     </TableRow>
                  )}
                  {runs.map(run => (
                     <TableRow key={run.id} className={run.success === false ? 'bg-destructive/5' : ''}>
                        <TableCell className="whitespace-nowrap font-medium">{run.search_name}</TableCell>
                        <TableCell className="whitespace-nowrap text-right">{asMediumDate(run.started_at)} {asTime(run.started_at)}</TableCell>
                        <TableCell className="whitespace-nowrap text-right">{formatDuration(run.started_at, run.finished_at)}</TableCell>
                        <TableCell className="text-center">
                           {run.success === true && <CheckCircle2Icon className="mx-auto size-4 text-green-600" />}
                           {run.success === false && <XCircleIcon className="mx-auto size-4 text-destructive" />}
                           {run.success == null && <span className="text-muted-foreground">–</span>}
                        </TableCell>
                        <TableCell className="text-right">{run.cars_found ?? '–'}</TableCell>
                        <TableCell className="text-right">{run.cars_scraped ?? '–'}</TableCell>
                        <TableCell className="text-right">{run.request_count ?? '–'}</TableCell>
                        <TableCell className="text-right">
                           {run.failed_request_count != null && run.failed_request_count > 0
                              ? <span className="text-destructive">{run.failed_request_count}</span>
                              : (run.failed_request_count ?? '–')
                           }
                        </TableCell>
                        <TableCell className="text-center">
                           <StatsPopover stats={run.stats} />
                        </TableCell>
                        <TableCell className="text-center">
                           <DeleteRunCell runId={run.id} />
                        </TableCell>
                     </TableRow>
                  ))}
               </TableBody>
            </Table>

            {/* Pagination */}
            {totalPages > 1 && (
               <div className="flex items-center justify-between border-t px-4 py-3">
                  <span className="text-sm text-muted-foreground">
                     Page {page} of {totalPages}
                  </span>
                  <div className="flex gap-1">
                     <Button
                        variant="outline"
                        size="sm"
                        disabled={page <= 1}
                        onClick={() => navigate({ page: page - 1 })}
                     >
                        <ChevronLeftIcon className="size-4" />
                        Previous
                     </Button>
                     <Button
                        variant="outline"
                        size="sm"
                        disabled={page >= totalPages}
                        onClick={() => navigate({ page: page + 1 })}
                     >
                        Next
                        <ChevronRightIcon className="size-4" />
                     </Button>
                  </div>
               </div>
            )}
         </CardContent>
      </Card>
   )
}
