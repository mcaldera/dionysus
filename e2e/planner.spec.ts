import { expect, test, type Page } from '@playwright/test'

// Map markers are drawn on a canvas, so bars are picked through the search box.
async function pick(page: Page, query: string) {
  await page.getByRole('searchbox', { name: 'Lokal suchen' }).fill(query)
  await page.locator('.search-hits button').first().click()
}

test.beforeEach(async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Wiener Durst' })).toBeVisible()
  await expect(page.getByTestId('map')).toBeVisible({ timeout: 30_000 })
  // New visitors start in the Beisl-Finder; these tests are about the tour planner.
  await page.getByRole('tab', { name: /Seidl-Tour/ }).click()
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

test('taste quiz in the plan dialog sets preferences', async ({ page }) => {
  await page.locator('.topbar').getByRole('button', { name: 'Tour planen' }).click()
  const plan = page.getByRole('dialog', { name: 'Tour planen' })
  await plan.getByRole('button', { name: 'Geschmackstest' }).click()
  const dialog = page.getByRole('dialog', { name: 'Geschmackstest' })
  await dialog.getByRole('button', { name: /Altes Beisl/ }).click()
  for (let i = 0; i < 6; i++) await dialog.getByRole('button', { name: 'Egal' }).click()
  await dialog.getByRole('button', { name: /Tschocherl/ }).click()
  await dialog.getByRole('button', { name: 'Weiter' }).click()
  await dialog.getByRole('button', { name: 'Übernehmen' }).click()
  await expect(dialog).toBeHidden()
  await expect(plan.locator('.chip.pref-like', { hasText: 'Urig' })).toBeVisible()
})

test('a click on empty map closes the bar and the filter menu', async ({ page }) => {
  await pick(page, 'Blunzenstricker')
  await expect(page.getByRole('heading', { name: 'Blunzenstricker', level: 2 })).toBeVisible()
  await page.locator('.filter-menu summary').click()
  const hint = page.getByText(/Filtert, was ihr auf der Karte/)
  await expect(hint).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(hint).toBeHidden()
  // Zoom out until the map's top-left area is outside Vienna, then click there.
  for (let i = 0; i < 4; i++) await page.getByRole('button', { name: 'Zoom out' }).click()
  await page.waitForTimeout(600)
  await page.locator('.filter-menu summary').click()
  await expect(hint).toBeVisible()
  await page.getByTestId('map').click({ position: { x: 40, y: 400 } })
  await expect(hint).toBeHidden()
  await expect(page.getByRole('heading', { name: 'Blunzenstricker', level: 2 })).toBeHidden()
})

test('the map filter narrows what is shown', async ({ page }) => {
  await page.locator('.filter-menu summary').click()
  const count = page.getByText(/· \d+ von \d+ Lokalen/)
  const before = await count.textContent()
  await page.getByRole('button', { name: /Fachpresse/ }).click()
  await expect(count).not.toHaveText(before ?? '')
  await expect(page.locator('.badge-count')).toHaveText('1')
})

test('empty template: fill one slot, clear one, then plan the rest', async ({ page }) => {
  await page.getByRole('button', { name: /Leere Vorlage/ }).click()
  await expect(page.locator('.timeline > li')).toHaveCount(23)
  await expect(page.locator('.timeline .empty-slot')).toHaveCount(23)
  await pick(page, 'Blunzenstricker')
  await page.getByRole('button', { name: 'In den offenen Platz setzen' }).click()
  await expect(page.locator('.timeline > li')).toHaveCount(23)
  await expect(page.locator('.timeline .empty-slot')).toHaveCount(22)
  await page.getByRole('button', { name: 'Tour fertig planen' }).click()
  await expect(page.locator('.timeline .empty-slot')).toHaveCount(0, { timeout: 30_000 })
  await expect(page.locator('.timeline .stop-name', { hasText: 'Blunzenstricker' })).toBeVisible()
  // Clearing keeps the place; deleting removes it.
  await page.locator('.timeline > li').nth(4).getByRole('button', { name: /leeren$/ }).click()
  await expect(page.locator('.timeline .empty-slot')).toHaveCount(1)
  await expect(page.locator('.timeline > li').nth(4)).toHaveClass(/empty-slot/)
  await page.getByRole('button', { name: 'Platz 5 löschen' }).click()
  await expect(page.locator('.timeline > li')).toHaveCount(22)
})
test('"Tour fertig planen" covers all included districts', async ({ page }) => {
  await pick(page, 'Blunzenstricker')
  await page.getByRole('button', { name: 'Zur Tour hinzufügen' }).click()
  await page.getByRole('button', { name: 'Tour fertig planen' }).click()
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
  // With a tour and nothing selected, the side panel shows statistics.
  await expect(page.getByRole('heading', { name: 'Eure Tour in Zahlen' })).toBeVisible()
})

test('stops can be reordered by drag and drop', async ({ page }) => {
  await page.getByRole('button', { name: /Komplette Tour vorschlagen/ }).click()
  await expect(page.locator('.proposal')).toHaveCount(3, { timeout: 60_000 })
  await page.locator('.proposal').first().getByRole('button', { name: 'Übernehmen' }).click()
  const names = page.locator('.timeline .stop-name')
  const second = await names.nth(1).textContent()
  await page.locator('.timeline > li').nth(1).dragTo(page.locator('.timeline > li').nth(3))
  await expect(names.nth(3)).toHaveText(second ?? '')
})

test.describe('Beisl-Finder', () => {
  test.beforeEach(async ({ page }) => {
    await page.getByRole('tab', { name: /Beisl-Finder/ }).click()
  })

  test('a bar shows what is reachable from it, in any district', async ({ page }) => {
    await expect(page.getByRole('heading', { name: /Wo seid ihr/ })).toBeVisible()
    await pick(page, 'Café Bendl')
    await expect(page.getByRole('heading', { name: 'Von Café Bendl aus' })).toBeVisible()
    const items = page.locator('[aria-label="In der Nähe"] .recs li')
    await expect(items.first()).toBeVisible()
    await page.getByRole('button', { name: '30′' }).click()
    await page.getByRole('button', { name: /Öffis/ }).click()
    expect(await items.count()).toBeGreaterThan(5)
    // No tour actions here; a Merkliste instead.
    await expect(page.getByRole('button', { name: 'Zur Tour hinzufügen' })).toHaveCount(0)
    await page.getByRole('button', { name: 'Merken' }).click()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('heading', { name: /Eure Merkliste/ })).toBeVisible()
  })

  test('a right-click sets a point to search from', async ({ page }) => {
    await expect(page.getByTestId('map')).toHaveAttribute('data-ready', '1', { timeout: 30_000 })
    await page.getByTestId('map').click({ button: 'right', position: { x: 500, y: 420 } })
    await expect(page.getByRole('heading', { name: /Gewählter Punkt/ })).toBeVisible()
    // Picking a bar from the list shows the way there from the point.
    await page.locator('[aria-label="In der Nähe"] .rec').first().click()
    await expect(page.locator('.finder-route')).toContainText('von Gewählter Punkt')
    await expect(page.locator('.finder-route a')).toHaveAttribute('href', /google\.com\/maps\/dir/)
    await page.keyboard.press('Escape')
    await page.getByRole('button', { name: 'Punkt entfernen' }).click()
    await expect(page.getByRole('heading', { name: /Wo seid ihr/ })).toBeVisible()
  })
})
