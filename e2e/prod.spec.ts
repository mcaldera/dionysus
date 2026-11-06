import { expect, test } from '@playwright/test'

// The production build, as deployed: the map must get its data (needs MapLibre's worker).
test('production build loads the map and its data', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
  await page.goto('/')
  await expect(page.getByTestId('map')).toHaveAttribute('data-ready', '1', { timeout: 60_000 })
  await page.getByRole('button', { name: 'Punkt auf der Karte setzen' }).click()
  await page.getByRole('searchbox', { name: 'Lokal suchen' }).fill('Café Bendl')
  await page.locator('.search-hits button').first().click()
  await expect(page.getByRole('heading', { name: 'Von Café Bendl aus' })).toBeVisible()
  await expect(page.locator('[aria-label="In der Nähe"] .recs li').first()).toBeVisible()
  expect(errors.filter((e) => /worker/i.test(e))).toEqual([])
})
