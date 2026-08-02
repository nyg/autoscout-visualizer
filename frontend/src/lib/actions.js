'use server'

import { revalidatePath } from 'next/cache'
import postgres from 'postgres'

import { deleteR2Objects } from '@/lib/r2'

const pgSql = postgres(process.env.PGSQL_URL, { prepare: false })

// The DB rows are already committed when R2 deletion runs, so leftovers are
// orphaned files rather than a failed operation. Report them instead of
// claiming a clean success.
function r2Warning({ orphanedCount, reason }) {
   if (orphanedCount === 0) {
      return null
   }
   const files = `${orphanedCount} file${orphanedCount !== 1 ? 's' : ''}`
   return `${files} could not be removed from storage${reason ? `: ${reason}` : '.'}`
}


export async function createSearch(prevState, formData) {
   const name = formData.get('name')?.toString().trim()
   const url = formData.get('url')?.toString().trim()

   if (!name || !url) {
      return { error: 'Name and URL are required.' }
   }

   try {
      await pgSql`
         insert into searches (name, url)
         values (${name}, ${url})`
      revalidatePath('/', 'layout')
      return { success: true }
   } catch (e) {
      if (e.code === '23505') {
         return { error: 'A search with this name already exists.' }
      }
      return { error: 'Failed to create search.' }
   }
}

export async function updateSearch(prevState, formData) {
   const id = parseInt(formData.get('id'), 10)
   const name = formData.get('name')?.toString().trim()
   const url = formData.get('url')?.toString().trim()
   const isActive = formData.get('is_active') === 'true'
   const screenshotsEnabled = formData.get('screenshots_enabled') === 'true'
   const photosEnabled = formData.get('photos_enabled') === 'true'

   if (!name || !url) {
      return { error: 'Name and URL are required.' }
   }

   try {
      await pgSql`
         update searches
            set name = ${name},
                url = ${url},
                is_active = ${isActive},
                screenshots_enabled = ${screenshotsEnabled},
                photos_enabled = ${photosEnabled},
                updated_at = current_timestamp
          where id = ${id}`
      revalidatePath('/', 'layout')
      return { success: true }
   } catch (e) {
      if (e.code === '23505') {
         return { error: 'A search with this name already exists.' }
      }
      return { error: 'Failed to update search.' }
   }
}

export async function deleteSearch(prevState, formData) {
   const id = parseInt(formData.get('id'), 10)
   const confirmed = formData.get('confirmed') === 'true'

   try {
      const [info] = await pgSql`
         select (select count(*)::int from search_runs where search_id = ${id}) as run_count,
                (select count(*)::int from cars where search_id = ${id}) as car_count,
                (select count(distinct c.screenshot_id) filter (where c.screenshot_id is not null)::int
                   from cars c where c.search_id = ${id}) as screenshot_count,
                (select count(distinct cp.photo_id)::int
                   from car_photos cp
                  inner join cars c on cp.car_id = c.id
                  where c.search_id = ${id}) as photo_count`

      if ((info.car_count > 0 || info.run_count > 0) && !confirmed) {
         return {
            needsConfirm: true,
            runCount: info.run_count,
            carCount: info.car_count,
            screenshotCount: info.screenshot_count,
            photoCount: info.photo_count,
         }
      }

      let r2Keys = []

      await pgSql.begin(async pgSql => {
         const screenshotIds = (await pgSql`
            select distinct screenshot_id from cars
             where search_id = ${id} and screenshot_id is not null`
         ).map(r => r.screenshot_id)

         const photoIds = (await pgSql`
            select distinct cp.photo_id
              from car_photos cp
             inner join cars c on cp.car_id = c.id
             where c.search_id = ${id}`
         ).map(r => r.photo_id)

         await pgSql`delete from cars where search_id = ${id}`

         if (screenshotIds.length > 0) {
            const deleted = await pgSql`
               delete from screenshots
                where id in ${pgSql(screenshotIds)}
                  and not exists (
                     select 1 from cars where cars.screenshot_id = screenshots.id
                  )
               returning r2_key`
            r2Keys.push(...deleted.map(r => r.r2_key).filter(Boolean))
         }

         if (photoIds.length > 0) {
            const deleted = await pgSql`
               delete from photos
                where id in ${pgSql(photoIds)}
                  and not exists (
                     select 1 from car_photos where car_photos.photo_id = photos.id
                  )
               returning r2_key`
            r2Keys.push(...deleted.map(r => r.r2_key).filter(Boolean))
         }

         await pgSql`delete from search_runs where search_id = ${id}`
         await pgSql`delete from searches where id = ${id}`
      })

      const r2Result = await deleteR2Objects(r2Keys)
      revalidatePath('/', 'layout')
      return { success: true, warning: r2Warning(r2Result) }
   } catch {
      return { error: 'Failed to delete search.' }
   }
}

export async function toggleSearchActive(prevState, formData) {
   const id = parseInt(formData.get('id'), 10)
   const isActive = formData.get('is_active') === 'true'

   try {
      await pgSql`
         update searches
            set is_active = ${isActive},
                updated_at = current_timestamp
          where id = ${id}`
      revalidatePath('/', 'layout')
      return { success: true }
   } catch {
      return { error: 'Failed to update search.' }
   }
}

export async function toggleSearchScreenshots(prevState, formData) {
   const id = parseInt(formData.get('id'), 10)
   const screenshotsEnabled = formData.get('screenshots_enabled') === 'true'

   try {
      await pgSql`
         update searches
            set screenshots_enabled = ${screenshotsEnabled},
                updated_at = current_timestamp
          where id = ${id}`
      revalidatePath('/', 'layout')
      return { success: true }
   } catch {
      return { error: 'Failed to update search.' }
   }
}

export async function toggleSearchPhotos(prevState, formData) {
   const id = parseInt(formData.get('id'), 10)
   const photosEnabled = formData.get('photos_enabled') === 'true'

   try {
      await pgSql`
         update searches
            set photos_enabled = ${photosEnabled},
                updated_at = current_timestamp
          where id = ${id}`
      revalidatePath('/', 'layout')
      return { success: true }
   } catch {
      return { error: 'Failed to update search.' }
   }
}

export async function deleteSearchRun(prevState, formData) {
   const id = parseInt(formData.get('id'), 10)
   const confirmed = formData.get('confirmed') === 'true'

   try {
      if (!confirmed) {
         const [info] = await pgSql`
            select count(c.id)::int as car_count,
                   count(distinct c.screenshot_id) filter (where c.screenshot_id is not null)::int as screenshot_count
              from cars c
             where c.search_run_id = ${id}`
         return {
            needsConfirm: true,
            carCount: info.car_count,
            screenshotCount: info.screenshot_count,
         }
      }

      let r2Keys = []

      await pgSql.begin(async pgSql => {
         const screenshotIds = (await pgSql`
            select distinct screenshot_id from cars
             where search_run_id = ${id} and screenshot_id is not null`
         ).map(r => r.screenshot_id)

         await pgSql`delete from cars where search_run_id = ${id}`

         if (screenshotIds.length > 0) {
            const deleted = await pgSql`
               delete from screenshots
                where id in ${pgSql(screenshotIds)}
                  and not exists (
                     select 1 from cars where cars.screenshot_id = screenshots.id
                  )
               returning r2_key`
            r2Keys = deleted.map(r => r.r2_key).filter(Boolean)
         }


         await pgSql`delete from search_runs where id = ${id}`
      })

      const r2Result = await deleteR2Objects(r2Keys)
      revalidatePath('/search-runs')
      return { success: true, warning: r2Warning(r2Result) }
   } catch {
      return { error: 'Failed to delete search run.' }
   }
}

export async function updateConfig(prevState, formData) {
   const entries = []
   for (const [key, value] of formData.entries()) {
      if (key.startsWith('config:')) {
         entries.push({ key: key.slice('config:'.length), value: value.toString().trim() })
      }
   }

   if (entries.length === 0) {
      return { error: 'No config values provided.' }
   }

   try {
      await pgSql.begin(async pgSql => {
         for (const { key, value } of entries) {
            await pgSql`
               insert into config (key, value) values (${key}, ${value})
               on conflict (key) do update set value = ${value}`
         }
      })
      revalidatePath('/settings')
      return { success: true }
   } catch {
      return { error: 'Failed to save settings.' }
   }
}

const VALID_RETENTION_DAYS = [30, 90, 180]

export async function deleteOldScreenshots(prevState, formData) {
   const days = parseInt(formData.get('days'), 10)
   const confirmed = formData.get('confirmed') === 'true'

   if (!VALID_RETENTION_DAYS.includes(days)) {
      return { error: 'Invalid retention period.' }
   }

   try {
      const cutoff = new Date()
      cutoff.setDate(cutoff.getDate() - days)

      if (!confirmed) {
         const [info] = await pgSql`
            select count(*)::int as count,
                   coalesce(sum(compressed_size), 0)::bigint as total_size
              from screenshots
             where created_at < ${cutoff}`
         return {
            needsConfirm: true,
            count: info.count,
            totalSize: Number(info.total_size),
            _days: days,
         }
      }

      // Match on the cutoff in both statements rather than round-tripping the
      // ids: a retention sweep covers tens of thousands of rows, and passing
      // them back as an `in (...)` list makes the query text enormous.
      const deleted = await pgSql.begin(async pgSql => {
         await pgSql`
            update cars set screenshot_id = null
             where screenshot_id in (select id from screenshots where created_at < ${cutoff})`
         return await pgSql`
            delete from screenshots where created_at < ${cutoff} returning r2_key`
      })

      const r2Keys = deleted.map(r => r.r2_key).filter(Boolean)
      const r2Result = await deleteR2Objects(r2Keys)

      revalidatePath('/settings')
      return {
         success: true,
         deletedCount: deleted.length,
         freedBytes: 0, // already deleted, can't sum
         warning: r2Warning(r2Result),
      }
   } catch {
      return { error: 'Failed to delete old screenshots.' }
   }
}
