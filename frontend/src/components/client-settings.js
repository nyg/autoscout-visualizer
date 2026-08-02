'use client'

import { useActionState, useEffect, useState } from 'react'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { updateConfig } from '@/lib/actions'

const CONFIG_KEYS = {
   mapsApiKey: 'google-maps-api-key',
   homeAddress: 'home-address',
   emailRecipient: 'email-recipient',
}

export default function ClientSettings({ config }) {
   const [apiKey, setApiKey] = useState(config[CONFIG_KEYS.mapsApiKey] ?? '')
   const [homeAddress, setHomeAddress] = useState(config[CONFIG_KEYS.homeAddress] ?? '')
   const [emailRecipient, setEmailRecipient] = useState(config[CONFIG_KEYS.emailRecipient] ?? '')
   const [state, formAction, isPending] = useActionState(updateConfig, {})
   const [showSaved, setShowSaved] = useState(false)
   const [lastResult, setLastResult] = useState(state)

   // Adjust during render rather than in an effect: the confirmation is derived
   // from the action result, so reacting to it in an effect would render once
   // without the message and then immediately again with it.
   if (state !== lastResult) {
      setLastResult(state)
      setShowSaved(Boolean(state.success))
   }

   useEffect(() => {
      if (!showSaved) {
         return
      }
      const timer = setTimeout(() => setShowSaved(false), 2000)
      return () => clearTimeout(timer)
   }, [showSaved])

   return (
      <Card>
         <CardHeader>
            <CardTitle>Settings</CardTitle>
         </CardHeader>
         <CardContent>
            <form action={formAction} className="flex flex-col gap-6">
               <div className="flex flex-col gap-2">
                  <label htmlFor="maps-api-key" className="text-sm font-medium">
                     Google Maps API Key
                  </label>
                  <p className="text-sm text-muted-foreground">
                     Used to display seller details from Google Maps.
                     Get an API key from the{' '}
                     <a
                        href="https://console.cloud.google.com/apis/credentials"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="underline hover:text-foreground"
                     >
                        Google Cloud Console
                     </a>
                     {' '}and enable the <strong>Maps JavaScript API</strong> and <strong>Places API (New)</strong>.
                  </p>
                  <input
                     id="maps-api-key"
                     name={`config:${CONFIG_KEYS.mapsApiKey}`}
                     type="text"
                     value={apiKey}
                     onChange={e => setApiKey(e.target.value)}
                     placeholder="Enter your API key"
                     className="rounded-md border bg-background px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-ring"
                  />
               </div>

               <div className="flex flex-col gap-2">
                  <label htmlFor="home-address" className="text-sm font-medium">
                     Home Address
                  </label>
                  <p className="text-sm text-muted-foreground">
                     Used to show directions from your home to car sellers.
                     Enter a full address (e.g. &ldquo;Bahnhofstrasse 1, 8001 Zürich&rdquo;).
                  </p>
                  <input
                     id="home-address"
                     name={`config:${CONFIG_KEYS.homeAddress}`}
                     type="text"
                     value={homeAddress}
                     onChange={e => setHomeAddress(e.target.value)}
                     placeholder="Enter your home address"
                     className="rounded-md border bg-background px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-ring"
                  />
               </div>

               <div className="flex flex-col gap-2">
                  <label htmlFor="email-recipient" className="text-sm font-medium">
                     Email Recipient
                  </label>
                  <p className="text-sm text-muted-foreground">
                     Email address to receive crawler run reports.
                     A batch summary email is sent after each <code className="text-xs">run-spiders.py</code> run.
                     Requires <code className="text-xs">RESEND_API_KEY</code> in the crawler <code className="text-xs">.env</code> file.
                  </p>
                  <input
                     id="email-recipient"
                     name={`config:${CONFIG_KEYS.emailRecipient}`}
                     type="email"
                     value={emailRecipient}
                     onChange={e => setEmailRecipient(e.target.value)}
                     placeholder="you@example.com"
                     className="rounded-md border bg-background px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-ring"
                  />
               </div>

               {state.error && (
                  <p className="text-sm text-destructive">{state.error}</p>
               )}

               <button
                  type="submit"
                  disabled={isPending}
                  className="self-end rounded-md bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
               >
                  {isPending ? 'Saving…' : showSaved ? '✓ Saved' : 'Save'}
               </button>
            </form>
         </CardContent>
      </Card>
   )
}
