'use client'

import { use, useActionState } from 'react'
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from 'recharts'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ChartContainer, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart'
import { deleteOldScreenshots } from '@/lib/actions'
import { formatBytes } from '@/lib/format'
import { useFormatter } from '@/lib/formatter-context'


const chartConfig = {
   total_size: { label: 'Size', color: 'var(--chart-1)' },
   count: { label: 'Screenshots', color: 'var(--chart-2)' },
}

const RETENTION_OPTIONS = [
   { days: 30, label: '30 days' },
   { days: 90, label: '90 days' },
   { days: 180, label: '180 days' },
]

function formatMB(bytes) {
   return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}


export default function ScreenshotStorage({ data, summary }) {
   const dailyData = use(data)
   const { total_count, total_size } = use(summary)
   const { asMediumDate, asShortDayMonthDate } = useFormatter()

   const chartData = dailyData.map(d => ({
      ...d,
      date: new Date(d.date).getTime(),
      total_size: Number(d.total_size),
   }))

   return (
      <Card>
         <CardHeader>
            <CardTitle>Screenshot Storage</CardTitle>
         </CardHeader>
         <CardContent className="flex flex-col gap-4">
            <p className="text-sm text-muted-foreground">
               {total_count} screenshot{total_count !== 1 ? 's' : ''} totalling {formatBytes(Number(total_size))}.
            </p>

            {chartData.length > 0 && (
               <ChartContainer config={chartConfig} className="min-h-50 w-full">
                  <BarChart data={chartData} margin={{ top: 10, right: 10, bottom: 0, left: 10 }}>
                     <CartesianGrid vertical={false} />
                     <XAxis
                        dataKey="date"
                        scale="time"
                        type="number"
                        domain={[min => min - 43200000, max => max + 43200000]}
                        tickFormatter={asShortDayMonthDate}
                        tickMargin={8}
                        tickLine={false}
                        axisLine={false}
                     />
                     <YAxis
                        tickFormatter={formatMB}
                        tickLine={false}
                        axisLine={false}
                        width={70}
                     />
                     <ChartTooltip
                        content={
                           <ChartTooltipContent
                              labelFormatter={(_, payload) => asMediumDate(payload[0]?.payload?.date)}
                              valueFormatter={formatBytes}
                           />
                        }
                     />
                     <Bar
                        dataKey="total_size"
                        fill="var(--color-total_size)"
                        fillOpacity={0.6}
                        radius={[4, 4, 0, 0]}
                        maxBarSize={50}
                     />
                  </BarChart>
               </ChartContainer>
            )}

            <CleanupSection />
         </CardContent>
      </Card>
   )
}


function CleanupSection() {
   const [state, submitAction, pending] = useActionState(deleteOldScreenshots, null)

   if (state?.success) {
      return (
         <div className="flex flex-col gap-1">
            <p className="text-sm text-green-600">
               Deleted {state.deletedCount} screenshot{state.deletedCount !== 1 ? 's' : ''}.
            </p>
            {state.warning && (
               <p className="text-sm text-destructive">
                  {state.warning} They are orphaned in storage and must be removed manually.
               </p>
            )}
         </div>
      )
   }

   if (state?.needsConfirm) {
      return (
         <form action={submitAction} className="flex items-center gap-2 flex-wrap">
            <input type="hidden" name="days" value={state._days} />
            <input type="hidden" name="confirmed" value="true" />
            <span className="text-sm text-destructive">
               Delete {state.count} screenshot{state.count !== 1 ? 's' : ''} ({formatBytes(state.totalSize)})?
            </span>
            <button
               type="submit"
               disabled={pending}
               autoFocus
               className="rounded-md border border-destructive/30 px-3 py-1 text-sm text-destructive transition-colors hover:bg-destructive/10 disabled:opacity-50"
            >
               {pending ? 'Deleting…' : 'Confirm'}
            </button>
         </form>
      )
   }

   return (
      <form action={submitAction} className="flex items-center gap-2 flex-wrap">
         <label className="text-sm text-muted-foreground">Delete screenshots older than</label>
         <select
            name="days"
            defaultValue="90"
            className="rounded-md border bg-background px-2 py-1 text-sm outline-none focus:ring-2 focus:ring-ring"
         >
            {RETENTION_OPTIONS.map(opt => (
               <option key={opt.days} value={opt.days}>{opt.label}</option>
            ))}
         </select>
         <button
            type="submit"
            disabled={pending}
            className="rounded-md border border-destructive/30 px-3 py-1 text-sm text-destructive transition-colors hover:bg-destructive/10 disabled:opacity-50"
         >
            {pending ? 'Checking…' : 'Delete'}
         </button>
         {state?.error && (
            <span className="text-sm text-destructive">{state.error}</span>
         )}
      </form>
   )
}
