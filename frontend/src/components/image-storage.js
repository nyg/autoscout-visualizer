'use client'

import { use, useActionState } from 'react'
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from 'recharts'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ChartContainer, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart'
import { deleteOldScreenshots, deleteRetiredPhotos } from '@/lib/actions'
import { useFormatter } from '@/lib/formatter-context'


const chartConfig = {
   total_size: { label: 'Size', color: 'var(--chart-1)' },
   count: { label: 'Images', color: 'var(--chart-2)' },
}


function StorageChart({ title, noun, data, summary }) {
   const dailyData = use(data)
   const { total_count, total_size } = summary
   const { asBytes, asDecimal, asMediumDate, asShortDayMonthDate } = useFormatter()

   const chartData = dailyData.map(d => ({
      ...d,
      date: new Date(d.date).getTime(),
      total_size: Number(d.total_size),
   }))

   return (
      <div className="flex flex-col gap-2">
         <p className="text-sm font-medium">{title}</p>
         <p className="text-sm text-muted-foreground">
            {asDecimal(total_count)} {noun}{total_count !== 1 ? 's' : ''} totalling {asBytes(Number(total_size))}.
         </p>
         {chartData.length > 0 && (
            <ChartContainer config={chartConfig} className="aspect-auto h-40 w-full">
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
                     tickFormatter={asBytes}
                     tickLine={false}
                     axisLine={false}
                     width={70}
                  />
                  <ChartTooltip
                     content={
                        <ChartTooltipContent
                           labelFormatter={(_, payload) => asMediumDate(payload[0]?.payload?.date)}
                           valueFormatter={asBytes}
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
      </div>
   )
}


export default function ImageStorage({ screenshotData, screenshotSummary, photoData, photoSummary }) {
   const { asBytes, asDecimal } = useFormatter()
   const screenshots = use(screenshotSummary)
   const photos = use(photoSummary)

   const totalCount = screenshots.total_count + photos.total_count
   const totalSize = Number(screenshots.total_size) + Number(photos.total_size)

   return (
      <Card>
         <CardHeader>
            <CardTitle>Image Storage</CardTitle>
         </CardHeader>
         <CardContent className="flex flex-col gap-4">
            <p className="text-sm">
               <span className="font-medium">{asBytes(totalSize)}</span>
               {' '}across {asDecimal(totalCount)} image{totalCount !== 1 ? 's' : ''} in total.
            </p>

            <div className="grid gap-6 md:grid-cols-2">
               <StorageChart
                  title="Page screenshots"
                  noun="screenshot"
                  data={screenshotData}
                  summary={screenshots}
               />
               <StorageChart
                  title="Car pictures"
                  noun="picture"
                  data={photoData}
                  summary={photos}
               />
            </div>

            <div className="flex flex-col gap-3 border-t pt-4">
               <CleanupForm
                  action={deleteOldScreenshots}
                  label="Delete screenshots older than"
                  noun="screenshot"
               />
               <CleanupForm
                  action={deleteRetiredPhotos}
                  label="Delete pictures of listings gone for more than"
                  noun="picture"
               />
            </div>
         </CardContent>
      </Card>
   )
}


function CleanupForm({ action, label, noun }) {
   const { asBytes, asDecimal } = useFormatter()
   const [state, submitAction, pending] = useActionState(action, null)
   const confirming = Boolean(state?.needsConfirm)
   const inputId = `retention-${noun}`

   return (
      <div className="flex flex-col gap-1">
         <form action={submitAction} className="flex items-center gap-2 flex-wrap">
            <label htmlFor={inputId} className="text-sm text-muted-foreground">{label}</label>
            <input
               id={inputId}
               name="days"
               type="number"
               defaultValue={state?.needsConfirm ? state._days : 30}
               min="1"
               max="3650"
               step="1"
               required
               readOnly={confirming}
               className="w-20 rounded-md border bg-background px-2 py-1 text-sm outline-none focus:ring-2 focus:ring-ring read-only:text-muted-foreground"
            />
            <span className="text-sm text-muted-foreground">days</span>
            {confirming ? (
               <>
                  <span className="text-sm text-destructive">
                     Delete {asDecimal(state.count)} {noun}{state.count !== 1 ? 's' : ''} ({asBytes(state.totalSize)})?
                  </span>
                  <button
                     type="submit"
                     name="confirm"
                     value={state._days}
                     disabled={pending}
                     autoFocus
                     className="rounded-md border border-destructive/30 px-3 py-1 text-sm text-destructive transition-colors hover:bg-destructive/10 disabled:opacity-50"
                  >
                     {pending ? 'Deleting…' : 'Confirm'}
                  </button>
                  <button
                     type="submit"
                     name="cancel"
                     value="true"
                     disabled={pending}
                     className="rounded-md border px-3 py-1 text-sm transition-colors hover:bg-muted disabled:opacity-50"
                  >
                     Cancel
                  </button>
               </>
            ) : (
               <button
                  type="submit"
                  disabled={pending}
                  className="rounded-md border border-destructive/30 px-3 py-1 text-sm text-destructive transition-colors hover:bg-destructive/10 disabled:opacity-50"
               >
                  {pending ? 'Checking…' : 'Delete'}
               </button>
            )}
         </form>

         {state?.success && (
            <>
               <p className="text-sm text-green-600">
                  Deleted {asDecimal(state.deletedCount)} {noun}{state.deletedCount !== 1 ? 's' : ''}.
               </p>
               {state.warning && (
                  <p className="text-sm text-destructive">
                     {state.warning} They are orphaned in storage and must be removed manually.
                  </p>
               )}
            </>
         )}

         {state?.error && <p className="text-sm text-destructive">{state.error}</p>}
      </div>
   )
}
