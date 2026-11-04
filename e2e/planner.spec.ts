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

test('taste finder sets preferences', async ({ page }) => {
  await page.getByRole('button', { name: '✨ Geschmackstest' }).click()
  const dialog = page.getByRole('dialog', { name: 'Geschmackstest' })
  for (let i = 0; i < 10; i++) {
    await dialog.getByRole('button', { name: '♥ Gefällt mir' }).click()
  }
  await dialog.getByRole('button', { name: 'Übernehmen' }).click()
  await expect(dialog).toBeHidden()
  await expect(page.getByText(/♥ Vorlieben \(\d+\)/)).toBeVisible()
})
