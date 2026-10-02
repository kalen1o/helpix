import { lookup as dnsLookup } from 'node:dns/promises'
import { BlockList, isIP } from 'node:net'
import { AppError } from '@helpix/shared'

export const BASE_URL_MAX = 500

export type LookupFn = (hostname: string) => Promise<{ address: string; family: number }[]>
export const defaultLookup: LookupFn = (hostname) => dnsLookup(hostname, { all: true })

const invalid = (message: string) => new AppError(400, 'invalid_base_url', message)

/** An absolute http(s) URL with no credentials, query or fragment; lower-cased origin, trailing slashes removed. */
export function normalizeBaseUrl(input: string): string {
  const raw = input.trim()
  if (!raw || raw.length > BASE_URL_MAX) throw invalid(`The order API URL must be 1–${BASE_URL_MAX} characters`)
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw invalid('The order API URL must be an absolute http(s) URL')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw invalid('The order API URL must start with http:// or https://')
  if (url.username || url.password) throw invalid('The order API URL must not contain a username or password')
  if (raw.includes('?') || raw.includes('#')) throw invalid('The order API URL must not contain a query string or fragment')
  const out = `${url.origin}${url.pathname}`.replace(/\/+$/, '')
  if (out.length > BASE_URL_MAX) throw invalid(`The order API URL must be 1–${BASE_URL_MAX} characters`)
  return out
}

// Addresses a shop's order API must never resolve to (4b spec §3.3). BlockList also matches IPv4-mapped IPv6.
const BLOCKED = new BlockList()
for (const [net, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['224.0.0.0', 4],
  ['255.255.255.255', 32],
] as const) {
  BLOCKED.addSubnet(net, prefix, 'ipv4')
}
for (const [net, prefix] of [
  ['::', 96], // :: , ::1 and IPv4-compatible ::a.b.c.d
  ['::ffff:0:0:0', 96], // IPv4-translated
  ['64:ff9b::', 96], // NAT64
  ['2002::', 16], // 6to4
  ['ff00::', 8],
  ['fc00::', 7],
  ['fe80::', 10],
] as const) {
  BLOCKED.addSubnet(net, prefix, 'ipv6')
}

export function isBlockedAddress(address: string): boolean {
  const family = isIP(address)
  if (family === 0) return true
  return BLOCKED.check(address, family === 6 ? 'ipv6' : 'ipv4')
}

/**
 * Unless private hosts are allowed: the URL must be https and its host must resolve only to public addresses.
 * Called when saving and before every call, so a DNS change cannot point a saved URL inside Helpix.
 */
export async function assertPublicHost(url: string, allowPrivate: boolean, lookup: LookupFn = defaultLookup): Promise<void> {
  if (allowPrivate) return
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    throw invalid('The order API URL must be an absolute https URL')
  }
  if (parsed.protocol !== 'https:') throw invalid('The order API URL must use https')
  const host = parsed.hostname.replace(/^\[(.*)\]$/, '$1')
  let addresses: string[]
  if (isIP(host)) {
    addresses = [host]
  } else {
    try {
      addresses = (await lookup(host)).map((a) => a.address)
    } catch {
      throw invalid(`Could not resolve ${host}`)
    }
  }
  if (addresses.length === 0 || addresses.some(isBlockedAddress)) {
    throw invalid('The order API URL must point to a public internet address')
  }
}

/**
 * A `net` lookup that refuses to connect when ANY resolved address is blocked, so the address that is
 * actually connected to is the one checked (no DNS-rebinding gap between check and connect).
 */
export function guardedLookup(lookup: LookupFn = defaultLookup) {
  return (
    hostname: string,
    options: { all?: boolean } | undefined,
    callback: (err: Error | null, address?: unknown, family?: number) => void,
  ): void => {
    const ips = isIP(hostname) ? Promise.resolve([{ address: hostname, family: isIP(hostname) }]) : lookup(hostname)
    ips.then(
      (addresses) => {
        if (addresses.length === 0 || addresses.some((a) => isBlockedAddress(a.address))) {
          callback(new Error('blocked address'))
        } else if (options?.all) {
          callback(null, addresses)
        } else {
          callback(null, addresses[0]!.address, addresses[0]!.family)
        }
      },
      (err: unknown) => callback(err instanceof Error ? err : new Error('lookup failed')),
    )
  }
}
