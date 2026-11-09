import { expect, test } from '@playwright/test'

// Phone layout: full-screen map, bottom sheet, two-row header.
test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })

test.beforeEach(async ({ page }) => {
  await page.goto('/')
  await expect(page.getByTestId('map')).toHaveAttribute('data-ready', '1', { timeout: 30_000 })
})

test('the page fits the screen; with nothing picked the map has it all', async ({ page }) => {
  const width = await page.evaluate(() => document.documentElement.scrollWidth)
  expect(width).toBeLessThanOrEqual(390)
  await expect(page.locator('.panel.sheet')).toHaveCount(0)
  // Without the footer, the map shows its own credits.
  await expect(page.locator('.maplibregl-ctrl-attrib')).toBeVisible()
})

test('search opens a bar in the sheet; the handle resizes it', async ({ page }) => {
  await page.getByRole('searchbox', { name: 'Lokal suchen' }).fill('Café Bendl')
  await page.locator('.search-hits button').first().click()
  await expect(page.getByRole('heading', { name: 'Café Bendl', level: 2 })).toBeVisible()
  // Credits move into the sheet.
  await expect(page.locator('.sheet .footer')).toHaveCount(1)
  const sheet = page.locator('.panel.sheet')
  await expect(sheet).toHaveAttribute('data-snap', 'half')
  await page.getByRole('button', { name: 'Bereich vergrößern oder verkleinern' }).click()
  await expect(sheet).toHaveAttribute('data-snap', 'full')
})

test('the open-hours choice sits in the time menu', async ({ page }) => {
  await expect(page.getByRole('group', { name: 'Öffnungszeiten' })).toBeHidden()
  await page.locator('.top-actions .popover summary').last().click()
  await expect(page.getByRole('group', { name: 'Öffnungszeiten' })).toBeVisible()
})

test('a district shows its figures only when asked', async ({ page }) => {
  // Tap the map: the district under it is focused, its figures stay closed.
  await page.getByTestId('map').tap({ position: { x: 195, y: 260 } })
  const stats = page.getByRole('button', { name: 'Statistik' })
  await expect(stats).toBeVisible()
  await expect(page.locator('.district-card')).toHaveCount(0)
  await stats.tap()
  await expect(page.locator('.sheet .district-card')).toBeVisible()
  // Closing the figures closes the sheet again; the district stays focused.
  await page.getByRole('button', { name: 'Bezirk schließen' }).tap()
  await expect(page.locator('.panel.sheet')).toHaveCount(0)
  await expect(stats).toBeVisible()
})

test('the map button sets a point', async ({ page }) => {
  await expect(page.locator('.panel.sheet')).toHaveCount(0)
  await page.getByRole('button', { name: 'Punkt auf der Karte setzen' }).tap()
  await expect(page.getByText('Tippt auf die Karte oder ein Lokal, um den Punkt zu setzen.')).toBeVisible()
  await page.getByTestId('map').tap({ position: { x: 195, y: 300 } })
  await expect(page.getByRole('heading', { name: /Gewählter Punkt/ })).toBeVisible()
  await expect(page.locator('.panel.sheet')).toHaveAttribute('data-snap', 'half')
})

test('Atlas: two fingers zoom, a tap keeps the map in view', async ({ page, context }) => {
  await page.getByRole('tab', { name: 'Atlas' }).click()
  await expect(page.locator('.atlas-node').first()).toBeVisible({ timeout: 20_000 })
  await page.waitForTimeout(1200)
  const zoom = () => page.locator('.atlas svg > g[transform]').getAttribute('transform')
  expect(await zoom()).toContain('scale(1)')
  await expect(page.locator('.atlas-name')).toHaveCount(0)

  const cdp = await context.newCDPSession(page)
  const touch = (type: string, spread: number) => cdp.send('Input.dispatchTouchEvent', {
    type: type as 'touchStart',
    touchPoints: type === 'touchEnd' ? [] : [{ x: 195 - spread, y: 420, id: 0 }, { x: 195 + spread, y: 420, id: 1 }],
  })
  await touch('touchStart', 40)
  for (const spread of [60, 90, 120, 150]) await touch('touchMove', spread)
  await touch('touchEnd', 150)
  await expect.poll(async () => Number((await zoom())!.match(/scale\(([\d.]+)\)/)![1])).toBeGreaterThan(3)
  await expect(page.locator('.atlas svg')).not.toHaveAttribute('style', /scale/)
  // Zoomed in, the dots have names.
  await expect(page.locator('.atlas-name').first()).toBeVisible()

  // A tap beside a dot still hits it; only its name comes up.
  const at = await page.evaluate(() => {
    const inView = [...document.querySelectorAll('.atlas-node:not(.hidden) circle')].map((c) => c.getBoundingClientRect())
      .find((r) => r.left > 60 && r.right < 330 && r.top > 300 && r.bottom < 600)!
    return { x: r2(inView.left + inView.width / 2 + 7), y: r2(inView.top + inView.height / 2) }
    function r2(v: number) { return Math.round(v) }
  })
  await page.touchscreen.tap(at.x, at.y)
  const sheet = page.locator('.panel.sheet')
  await expect(sheet).toHaveAttribute('data-snap', 'peek')
  await expect(sheet.getByRole('heading', { level: 2 })).toBeVisible()
  expect((await sheet.boundingBox())!.height).toBeLessThan(100)
  await expect(page.locator('.atlas > .atlas-focus')).toHaveCount(0)
  await expect(page.locator('.atlas-rings')).toBeVisible()
  // The radar says in words how close each zone is and names the closest bars.
  await expect(page.locator('.atlas-ring-labels text')).toHaveText(['sehr ähnlich', 'ähnlich', 'etwas gemeinsam', 'ganz anders'])
  await expect(page.locator('.atlas-name.chosen')).toBeVisible()
  expect(await page.locator('.atlas-name').count()).toBeGreaterThan(3)

  // The details are one tap further, in the sheet.
  await sheet.locator('.hero-text').tap()
  await expect(sheet).toHaveAttribute('data-snap', 'half')
  await expect(sheet.locator('.atlas-focus')).toHaveCount(1)
})
