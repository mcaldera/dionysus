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
  await expect(page.getByText('Tippt auf die Karte, um den Punkt zu setzen.')).toBeVisible()
  await page.getByTestId('map').tap({ position: { x: 195, y: 300 } })
  await expect(page.getByRole('heading', { name: /Gewählter Punkt/ })).toBeVisible()
  await expect(page.locator('.panel.sheet')).toHaveAttribute('data-snap', 'half')
})
