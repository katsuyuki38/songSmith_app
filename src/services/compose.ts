import type { ComposeRequest, ComposeResponse } from '../types'
import { mockCompose } from './mockCompose'

const envBase = (import.meta.env.VITE_API_BASE as string | undefined) || ''
const API_URL = envBase ? `${envBase}/compose` : '/compose'
const REQUEST_TIMEOUT_MS = 20000

export const compose = async (req: ComposeRequest): Promise<ComposeResponse> => {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req),
      signal: controller.signal,
    })
    if (!res.ok) {
      throw new Error(`API error ${res.status}`)
    }
    const data = (await res.json()) as ComposeResponse
    if (!data?.variants?.length) throw new Error('Empty variants')
    return data
  } catch (error) {
    console.warn('compose: falling back to mock', error)
    return mockCompose(req)
  } finally {
    clearTimeout(timer)
  }
}
