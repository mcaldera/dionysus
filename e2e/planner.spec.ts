import { expect, test, type Page } from '@playwright/test'

// Map markers are drawn on a canvas, so bars are picked through the search box.
async function pick(page: Page, query: string) {
  await page.getByRole('searchbox', { name: 'Lokal suchen' }).fill(query)
  await page.locator('.search-hits button').first().click()
}

test.beforeEach(async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Seidl-Tour-Planer' })).toBeVisible()
  await expect(page.getByTestId('map')).toBeVisible({ timeout: 30_000 })
})

test('selecting a bar opens the panel and shows 5 recommendations', async ({ page }) => {
  await pick(page, 'Blunzenstricker')
  await expect(page.getByRole('heading', { name: 'Blunzenstricker', level: 2 })).toBeVisible()
  await expect(page.locator('.recs li')).toHaveCount(5)
})

test('adding a bar updates the tour and its district leaves the recommendations', async ({ page }) => {
  await pick(page, 'Blunzenstricker')
  await page.getByRole('button', { name: 'Zur Tour hinzufügen' }).click()
  await expect(page.locator('.timeline li')).toHaveCount(1)
  await expect(page.getByText('1 von 23 Bezirken')).toBeVisible()
  const metas = await page.locator('.recs .rec-meta').allTextContents()
  expect(metas.length).toBe(5)
  for (const m of metas) expect(m).not.toContain('16. Bezirk')

  await page.locator('.recs button').first().click()
  await page.getByRole('button', { name: 'Zur Tour hinzufügen' }).click()
  await expect(page.locator('.timeline li')).toHaveCount(2)
  await expect(page.locator('.timeline .leg a', { hasText: 'Route' })).toHaveAttribute('href', /google\.com\/maps\/dir/)
})

test('attribution is visible', async ({ page }) => {
  await expect(page.getByText('© OpenStreetMap-Mitwirkende (ODbL)')).toBeVisible()
  await expect(page.getByText('Kein offizielles Angebot der Ottakringer Brauerei.')).toBeVisible()
})

test('taste quiz sets preferences', async ({ page }) => {
  await page.getByRole('button', { name: '✨ Geschmackstest' }).click()
  const dialog = page.getByRole('dialog', { name: 'Geschmackstest' })
  await dialog.getByRole('button', { name: /Altes Beisl/ }).click()
  for (let i = 0; i < 6; i++) await dialog.getByRole('button', { name: 'Egal' }).click()
  await dialog.getByRole('button', { name: /Tschocherl/ }).click()
  await dialog.getByRole('button', { name: 'Weiter' }).click()
  await expect(dialog.getByText('♥ Urig')).toBeVisible()
  await dialog.getByRole('button', { name: 'Übernehmen' }).click()
  await expect(dialog).toBeHidden()
  await expect(page.getByText('♥ Vorlieben (2)')).toBeVisible()
})

test('a click on empty map closes the bar and open popovers', async ({ page }) => {
  await pick(page, 'Blunzenstricker')
  await expect(page.getByRole('heading', { name: 'Blunzenstricker', level: 2 })).toBeVisible()
  await page.getByText(/♥ Vorlieben/).click()
  await expect(page.getByText('Klicken: mag → lieber nicht → egal')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByText('Klicken: mag → lieber nicht → egal')).toBeHidden()
  await page.getByText(/♥ Vorlieben/).click()
  // Zoom out until the map's top-left corner is outside Vienna, then click there.
  for (let i = 0; i < 4; i++) await page.getByRole('button', { name: 'Zoom out' }).click()
  await page.waitForTimeout(600)
  await page.getByTestId('map').click({ position: { x: 30, y: 30 } })
  await expect(page.getByText('Klicken: mag → lieber nicht → egal')).toBeHidden()
  await expect(page.getByRole('heading', { name: 'Blunzenstricker', level: 2 })).toBeHidden()
})

test('"Tour fertig planen" covers all included districts', async ({ page }) => {
  await pick(page, 'Blunzenstricker')
  await page.getByRole('button', { name: 'Zur Tour hinzufügen' }).click()
  await page.getByRole('button', { name: '✨ Tour fertig planen' }).click()
  await expect(page.locator('.timeline > li')).toHaveCount(23, { timeout: 30_000 })
  await expect(page.getByText(/23 von 23 Bezirken/)).toBeVisible()
  // The prefix stays first.
  await expect(page.locator('.timeline .stop-name').first()).toContainText('Blunzenstricker')
})

test('proposals can be applied and a stop swapped', async ({ page }) => {
  await page.getByRole('button', { name: /Komplette Tour vorschlagen/ }).click()
  await expect(page.locator('.proposal')).toHaveCount(3, { timeout: 60_000 })
  await page.locator('.proposal').first().getByRole('button', { name: 'Übernehmen' }).click()
  await expect(page.locator('.timeline > li')).toHaveCount(23)
  const second = await page.locator('.timeline .stop-name').nth(1).textContent()
  await page.locator('.timeline > li').nth(1).getByRole('button', { name: /tauschen$/ }).click()
  await expect(page.locator('.swap-list .rec').first()).toBeVisible()
  await page.locator('.swap-list .rec').first().click()
  await expect(page.locator('.timeline .stop-name').nth(1)).not.toHaveText(second ?? '')
  await expect(page.locator('.timeline > li').nth(1).getByRole('button', { name: /fixieren$/ })).toHaveAttribute('aria-pressed', 'true')
})
