import 'server-only'

import { DeleteObjectsCommand, S3Client } from '@aws-sdk/client-s3'

let s3Client = null

function getS3Client() {
   if (s3Client) {
      return s3Client
   }
   const { R2_ENDPOINT_URL, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY } = process.env
   if (!R2_ENDPOINT_URL || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY) {
      return null
   }
   s3Client = new S3Client({
      endpoint: R2_ENDPOINT_URL,
      region: 'auto',
      credentials: {
         accessKeyId: R2_ACCESS_KEY_ID,
         secretAccessKey: R2_SECRET_ACCESS_KEY,
      },
   })
   return s3Client
}

/**
 * Deletes objects from R2.
 *
 * Never throws: the DB rows are already gone by the time this runs, so a failure
 * here leaves orphaned objects rather than breaking the caller. Callers must
 * check `orphanedCount` and surface it — a silent failure looks like success.
 *
 * @returns {Promise<{ requestedCount: number, orphanedCount: number, reason: string | null }>}
 */
export async function deleteR2Objects(keys) {
   const requestedCount = keys?.length ?? 0
   if (requestedCount === 0) {
      return { requestedCount: 0, orphanedCount: 0, reason: null }
   }

   const client = getS3Client()
   const bucket = process.env.R2_BUCKET_NAME
   if (!client || !bucket) {
      console.warn(`R2 not configured — ${requestedCount} object(s) left orphaned in storage`)
      return { requestedCount, orphanedCount: requestedCount, reason: 'R2 is not configured' }
   }

   let orphanedCount = 0
   let reason = null

   // S3 DeleteObjects supports up to 1000 keys per request
   for (let i = 0; i < keys.length; i += 1000) {
      const batch = keys.slice(i, i + 1000)
      try {
         const response = await client.send(new DeleteObjectsCommand({
            Bucket: bucket,
            Delete: { Objects: batch.map(Key => ({ Key })) },
         }))
         if (response.Errors?.length > 0) {
            orphanedCount += response.Errors.length
            reason ??= response.Errors[0].Code || 'R2 rejected the deletion'
            console.error(`Partial R2 deletion failure (batch ${i / 1000 + 1}):`,
               response.Errors.map(e => ({ key: e.Key, code: e.Code, message: e.Message })))
         }
      } catch (err) {
         orphanedCount += batch.length
         reason ??= err.message
         console.error(`Failed to delete R2 objects (batch ${i / 1000 + 1}):`, err.message)
      }
   }

   return { requestedCount, orphanedCount, reason }
}
