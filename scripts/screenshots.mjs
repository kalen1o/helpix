// Captures admin-dashboard screenshots for the README into docs/screenshots/.
// Needs the stack and the dashboard running (`make start` or `make dev`). Run with `make screenshots`.
// Uses the installed Google Chrome through playwright-core, so no browser download is needed.
import { randomBytes } from 'node:crypto'
import { mkdir } from 'node:fs/promises'
import { chromium } from 'playwright-core'

const GATEWAY = process.env.GATEWAY_URL ?? 'http://localhost:4000'
const DASHBOARD = process.env.DASHBOARD_URL ?? 'http://localhost:5173'
const EMAIL = process.env.SEED_SUPERADMIN_EMAIL
const PASSWORD = process.env.SEED_SUPERADMIN_PASSWORD
const OUT = 'docs/screenshots'

// Demo data shown in the screenshots. Existing tenants and admins are reused, so reruns are safe.
const DEMO_TENANTS = [
  {
    name: 'iStore Saigon',
    slug: 'istore-saigon',
    allowedOrigins: ['https://istore.example', 'http://localhost:5174'],
    admin: 'owner@istore.example',
  },
  {
    name: 'Teen Fashion',
    slug: 'teen-fashion',
    allowedOrigins: ['https://teenfashion.example', 'http://localhost:5175'],
    admin: 'owner@teenfashion.example',
  },
]

async function api(method, path, { token, body } = {}) {
  const res = await fetch(`${GATEWAY}${path}`, {
    method,
    headers: {
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const json = await res.json().catch(() => null)
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${json?.error?.code ?? ''}`)
  return json
}

async function ensureDemoData() {
  const { accessToken: token } = await api('POST', '/auth/login', { body: { email: EMAIL, password: PASSWORD } })
  const { tenants } = await api('GET', '/admin/tenants', { token })
  for (const demo of DEMO_TENANTS) {
    let tenant = tenants.find((t) => t.slug === demo.slug)
    tenant ??= await api('POST', '/admin/tenants', { token, body: { name: demo.name, slug: demo.slug } })
    if (tenant.status !== 'active') await api('POST', `/admin/tenants/${tenant.id}/reactivate`, { token })
    await api('PATCH', `/admin/tenants/${tenant.id}`, { token, body: { allowedOrigins: demo.allowedOrigins } })
    const { admins } = await api('GET', `/admin/tenants/${tenant.id}/admins`, { token })
    if (!admins.some((a) => a.email === demo.admin)) {
      await api('POST', `/admin/tenants/${tenant.id}/admins`, {
        token,
        body: { email: demo.admin, password: randomBytes(12).toString('base64url') },
      })
    }
    demo.id = tenant.id
  }
}

async function capture(browser, colorScheme) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2, colorScheme })
  const page = await context.newPage()
  const shot = (name, options = {}) => page.screenshot({ path: `${OUT}/${name}-${colorScheme}.png`, ...options })
  // Dialogs animate in over 200ms; wait for the transition to settle.
  const settle = () => page.waitForTimeout(350)

  await page.goto(`${DASHBOARD}/login`)
  await page.locator('#email').waitFor()
  await shot('login')

  await page.fill('#email', EMAIL)
  await page.fill('#password', PASSWORD)
  await page.click('button[type="submit"]')
  await page.waitForURL('**/tenants')
  await page.getByText('iStore Saigon').waitFor()
  await shot('tenants')

  if (colorScheme === 'light') {
    await page.getByRole('button', { name: 'New tenant' }).click()
    await page.fill('#tenant-name', 'Cửa hàng Táo')
    await settle()
    await shot('new-tenant')
    await page.keyboard.press('Escape')
  }

  await page.goto(`${DASHBOARD}/tenants/${DEMO_TENANTS[0].id}`)
  await page.getByText('owner@istore.example').waitFor()
  await shot('tenant-detail', { fullPage: true })

  if (colorScheme === 'dark') {
    await page.getByRole('button', { name: 'Suspend' }).click()
    await settle()
    await shot('suspend-dialog')
    await page.keyboard.press('Escape')
  }

  await context.close()
}

if (!EMAIL || !PASSWORD) {
  console.error('SEED_SUPERADMIN_EMAIL and SEED_SUPERADMIN_PASSWORD must be set (run via `make screenshots`).')
  process.exit(1)
}

await mkdir(OUT, { recursive: true })
await ensureDemoData()
const browser = await chromium.launch({ channel: 'chrome' })
try {
  await capture(browser, 'light')
  await capture(browser, 'dark')
} finally {
  await browser.close()
}
console.log(`Screenshots written to ${OUT}/`)
