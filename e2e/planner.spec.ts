import { expect, test, type Page } from '@playwright/test'

// Map markers are drawn on a canvas, so bars are picked through the search box.
async function fromPlanDialog(page: Page, button: RegExp) {
  await page.locator('.topbar').getByRole('button', { name: 'Tour planen' }).click()
  await page.getByRole('dialog', { name: 'Tour planen' }).getByRole('button', { name: button }).click()
}

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

test('a tour exports as Excel and GPX', async ({ page }) => {
  await pick(page, 'Blunzenstricker')
  await page.getByRole('button', { name: 'Zur Tour hinzufügen' }).click()
  await page.locator('.recs button').first().click()
  await page.getByRole('button', { name: 'Zur Tour hinzufügen' }).click()
  await expect(page.locator('.timeline li')).toHaveCount(2)
  const exports = page.locator('.tour-export')
  for (const [label, ext] of [['Excel', '.xlsx'], ['GPX', '.gpx']]) {
    const [file] = await Promise.all([page.waitForEvent('download'), exports.getByRole('button', { name: label }).click()])
    expect(file.suggestedFilename()).toMatch(new RegExp(`^seidl-tour-.*\\${ext}$`))
    const path = await file.path()
    expect(path).toBeTruthy()
  }
})

test('attribution is visible', async ({ page }) => {
  await expect(page.getByText('© OpenStreetMap-Mitwirkende (ODbL)')).toBeVisible()
})

test('taste quiz in the plan dialog sets preferences', async ({ page }) => {
  await page.locator('.topbar').getByRole('button', { name: 'Tour planen' }).click()
  const plan = page.getByRole('dialog', { name: 'Tour planen' })
  await plan.getByRole('button', { name: 'Geschmackstest' }).click()
  const dialog = page.getByRole('dialog', { name: 'Geschmackstest' })
  await dialog.getByRole('button', { name: /Altes Beisl/ }).click()
  for (let i = 0; i < 7; i++) await dialog.getByRole('button', { name: 'Egal' }).click()
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
  const hint = page.locator('.filter-menu .popover-body')
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
  await pick(page, 'Blunzenstricker')
  await page.locator('.filter-menu summary').click()
  await page.getByRole('button', { name: /Fachpresse/ }).click()
  await expect(page.locator('.filter-menu .badge-count')).toHaveText('1')
  // Recommendations come only from bars the press recommends.
  const recs = page.locator('.recs li')
  await expect(recs.first()).toBeVisible()
  for (const li of await recs.all()) await expect(li.locator('.tip-badge')).toHaveCount(1)
})

test('empty template: fill one slot, clear one, then plan the rest', async ({ page }) => {
  await fromPlanDialog(page, /Leere Vorlage/)
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
  await fromPlanDialog(page, /Komplette Tour vorschlagen/)
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
  await fromPlanDialog(page, /Komplette Tour vorschlagen/)
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

  test('picking a bar only shows it', async ({ page }) => {
    await pick(page, 'Café Bendl')
    await expect(page.locator('.bar-card')).toBeVisible()
    await expect(page.locator('[aria-label="In der Nähe"]')).toHaveCount(0)
    await pick(page, 'Blunzenstricker')
    await expect(page.getByRole('heading', { name: 'Blunzenstricker', level: 2 })).toBeVisible()
    await expect(page.locator('[aria-label="In der Nähe"]')).toHaveCount(0)
  })

  test('the marker put on a bar shows what is reachable from it, in any district', async ({ page }) => {
    await expect(page.locator('.panel .card')).toHaveCount(0)
    await page.getByRole('button', { name: 'Punkt auf der Karte setzen' }).click()
    await pick(page, 'Café Bendl')
    await expect(page.getByRole('heading', { name: 'Von Café Bendl aus' })).toBeVisible()
    const items = page.locator('[aria-label="In der Nähe"] .recs li')
    await expect(items.first()).toBeVisible()
    await page.getByRole('button', { name: '30′' }).click()
    await page.getByRole('button', { name: /Öffis/ }).click()
    expect(await items.count()).toBeGreaterThan(5)
    // No tour actions here.
    await expect(page.getByRole('button', { name: 'Zur Tour hinzufügen' })).toHaveCount(0)
    // Another bar from the list: its details and the way there, while the list stays at Café Bendl.
    await items.first().locator('button').click()
    await expect(page.locator('.finder-route')).toContainText('von Café Bendl')
    await expect(page.getByRole('heading', { name: 'Von Café Bendl aus' })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.locator('.bar-card')).toHaveCount(0)
    await expect(page.getByRole('heading', { name: 'Von Café Bendl aus' })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.locator('.panel .card')).toHaveCount(0)
  })

  test('"Meine Lokale" keeps hearted bars and filters the map to them', async ({ page }) => {
    await pick(page, 'Café Bendl')
    await page.getByRole('button', { name: 'Merken' }).click()
    await expect(page.getByRole('button', { name: 'Gemerkt' })).toBeVisible()
    await page.locator('.my-bars summary').click()
    await expect(page.locator('.my-bars .fav-list li')).toHaveCount(1)
    await page.getByLabel('Nur meine Lokale auf der Karte').check()
    // From a point on that bar, nothing else is left to reach.
    await page.getByRole('button', { name: 'Punkt auf der Karte setzen' }).click()
    await pick(page, 'Café Bendl')
    await expect(page.locator('[aria-label="In der Nähe"]')).toContainText('Nichts in dieser Zeit')
    await page.reload()
    await expect(page.locator('.my-bars .badge-count')).toHaveText('1')
  })

  test('a shared link offers its list', async ({ page }) => {
    await page.goto('/#meine=n46823888')
    await page.getByRole('button', { name: 'Zu meinen Lokalen' }).click()
    await expect(page.locator('.my-bars .badge-count')).toHaveText('1')
    expect(page.url()).not.toContain('meine=')
  })

  test('a right-click sets a point to search from', async ({ page }) => {
    await expect(page.getByTestId('map')).toHaveAttribute('data-ready', '1', { timeout: 30_000 })
    await page.getByTestId('map').click({ button: 'right', position: { x: 500, y: 420 } })
    await expect(page.getByRole('heading', { name: /Gewählter Punkt/ })).toBeVisible()
    // Picking a bar from the list shows the way there from the point; the list stays at the point.
    await page.locator('[aria-label="In der Nähe"] .rec').first().click()
    await expect(page.locator('.finder-route')).toContainText('von Gewählter Punkt')
    await expect(page.locator('.finder-route a')).toHaveAttribute('href', /google\.com\/maps\/dir/)
    await expect(page.getByRole('heading', { name: /Gewählter Punkt/ })).toBeVisible()
    // A click on empty map steps back to the point's list; a second one clears the point.
    await page.getByTestId('map').click({ position: { x: 40, y: 400 } })
    await expect(page.locator('.bar-card')).toHaveCount(0)
    await expect(page.getByRole('heading', { name: /Gewählter Punkt/ })).toBeVisible()
    await page.getByTestId('map').click({ position: { x: 40, y: 400 } })
    await expect(page.locator('.panel .card')).toHaveCount(0)
    // Escape clears a point as well.
    await page.getByTestId('map').click({ button: 'right', position: { x: 500, y: 420 } })
    await expect(page.getByRole('heading', { name: /Gewählter Punkt/ })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.locator('.panel .card')).toHaveCount(0)
  })
})
