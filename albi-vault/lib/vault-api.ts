'use client'

import { createClient } from '@/lib/supabase/client'

const functionUrl = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/vault-api`

export async function vaultApi<T = any>(action: string, payload: Record<string, unknown> = {}): Promise<T> {
  const supabase = createClient()
  const { data: { session }, error } = await supabase.auth.getSession()
  if (error || !session?.access_token) throw new Error('Not authenticated')

  const res = await fetch(functionUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${session.access_token}`,
      'apikey': process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    },
    body: JSON.stringify({ action, ...payload }),
    cache: 'no-store',
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || 'Request failed')
  return data as T
}
