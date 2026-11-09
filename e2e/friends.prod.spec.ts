import { expect, test, type Page } from '@playwright/test'

// Friends' features end to end: the production build on the real Worker with a local D1 database.
const CODE = 'e2e-einladungscode'
const PASSWORD = 'bier'
const run = Date.now().toString(36)

async function open(page: Page) {
  await page.goto('/')
  await expect(page.getByTestId('map')).toHaveAttribute('data-ready', '1', { timeout: 60_000 })
}

async function join(page: Page, name: string) {
  await page.locator('.friends-btn').click()
  const dialog = page.getByRole('dialog', { name: 'Freunde' })
  await dialog.getByLabel('Einladungscode').fill(CODE)
  await dialog.getByLabel('Dein Name').fill(name)
  await dialog.getByLabel('Passwort').fill(PASSWORD)
  await dialog.getByRole('button', { name: 'Mitmachen' }).last().click()
  await expect(dialog.getByRole('tab', { name: 'Profil' })).toBeVisible()
  await dialog.getByRole('button', { name: 'Schließen' }).click()
}

async function myListsCount(page: Page, n: number) {
  await expect(page.locator('.my-bars .badge-count')).toHaveText(String(n))
}

async function pick(page: Page, query: string) {
  await page.getByRole('searchbox', { name: 'Lokal suchen' }).fill(query)
  await page.locator('.search-hits button').first().click()
  await expect(page.getByRole('heading', { name: query, level: 2 })).toBeVisible()
}

test('friends rate, comment, keep lists, filter by them and get recommendations', async ({ page, browser }) => {
  test.setTimeout(120_000)
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))

  const flo = `Flo${run}`
  await open(page)

  // Reading works without a profile; writing asks you to join.
  await pick(page, 'Café Bendl')
  await expect(page.getByRole('button', { name: /Mitmachen, um zu bewerten/ })).toBeVisible()

  // A wrong code is refused with a message.
  await page.locator('.friends-btn').click()
  const dialog = page.getByRole('dialog', { name: 'Freunde' })
  await dialog.getByLabel('Einladungscode').fill('falscher-code-123')
  await dialog.getByLabel('Dein Name').fill(flo)
  await dialog.getByLabel('Passwort').fill(PASSWORD)
  await dialog.getByRole('button', { name: 'Mitmachen' }).last().click()
  await expect(dialog.getByRole('alert')).toContainText('stimmt nicht')
  await dialog.getByRole('button', { name: 'Schließen' }).click()

  await join(page, flo)
  const panel = page.getByLabel('Ausgewähltes Lokal')

  // Rate, comment, add to the automatic list.
  await panel.getByRole('button', { name: '5 Sterne' }).click()
  await expect(panel.locator('.social-avg')).toContainText('5,0')
  await panel.getByLabel('Kommentar', { exact: true }).fill('Bestes Bier im Grätzl')
  await panel.getByRole('button', { name: 'Kommentieren' }).click()
  await expect(panel.locator('.comments')).toContainText('Bestes Bier im Grätzl')
  // The heart is the main list, so there's no second control for it.
  await expect(panel.getByRole('button', { name: `Favoriten von ${flo}` })).toHaveCount(0)
  await panel.getByRole('button', { name: 'Merken' }).click()
  await expect(panel.getByRole('button', { name: 'Gemerkt' })).toBeVisible()
  await myListsCount(page, 1)

  // It all survives a reload, and the profile with it.
  await page.reload()
  await expect(page.getByTestId('map')).toHaveAttribute('data-ready', '1', { timeout: 60_000 })
  await pick(page, 'Café Bendl')
  await expect(panel.locator('.comments')).toContainText('Bestes Bier im Grätzl')
  await expect(panel.getByRole('button', { name: '5 Sterne' })).toHaveAttribute('aria-pressed', 'true')
  await expect(panel.getByRole('button', { name: 'Gemerkt' })).toBeVisible()

  // The friends' filter counts as an active filter (domain tests cover what it keeps).
  await page.locator('.filter-menu summary').click()
  await page.locator('.filter-menu').getByRole('button', { name: /Mit Kommentaren/ }).click()
  await expect(page.locator('.filter-menu .badge-count')).toHaveText('1')

  // A second friend sees it, and gets a recommendation with the reason.
  const other = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const anna = await other.newPage()
  await open(anna)
  await join(anna, `Anna${run}`)
  await anna.locator('.friends-btn').click()
  const annaDialog = anna.getByRole('dialog', { name: 'Freunde' })
  await expect(annaDialog.locator('.bar-rows')).toContainText('Café Bendl')
  await expect(annaDialog.locator('.bar-rows')).toContainText(`${flo} gibt 5 ★`)

  // "Meine Lokale" starts private: Anna can't see Flo's until Flo shares it.
  await annaDialog.getByRole('tab', { name: 'Listen' }).click()
  await expect(annaDialog).not.toContainText(`Favoriten von ${flo}`)
  await page.locator('.filter-menu summary').click()
  await page.locator('.my-bars summary').click()
  await page.locator('.my-bars').getByRole('checkbox', { name: 'Für Freunde sichtbar' }).check()
  await expect(page.locator('.my-bars').getByRole('checkbox', { name: 'Für Freunde sichtbar' })).toBeChecked()
  await anna.reload()
  await expect(anna.getByTestId('map')).toHaveAttribute('data-ready', '1', { timeout: 60_000 })
  await anna.locator('.friends-btn').click()
  await annaDialog.getByRole('tab', { name: 'Listen' }).click()

  // Now it's visible, and can't be edited by someone else.
  await annaDialog.getByRole('button', { name: new RegExp(`Favoriten von ${flo}`) }).click()
  await expect(annaDialog.locator('.bar-rows')).toContainText('Café Bendl')
  await expect(annaDialog.getByRole('button', { name: 'Löschen' })).toHaveCount(0)
  await annaDialog.getByRole('button', { name: 'Zu meinen Lokalen' }).click()
  await expect(annaDialog.getByRole('status')).toContainText('hinzugefügt')
  await myListsCount(anna, 1)

  // A person's ranking.
  await annaDialog.getByRole('tab', { name: 'Bestenliste' }).click()
  await annaDialog.getByLabel('Bestenliste von').selectOption({ label: flo })
  await expect(annaDialog.locator('.bar-rows')).toContainText('Café Bendl')
  await other.close()

  expect(errors).toEqual([])
})

test('a device link signs in on another browser and leaves the address clean', async ({ page, browser, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await open(page)
  const name = `Geraet${run}`
  await join(page, name)
  await page.locator('.friends-btn').click()
  const dialog = page.getByRole('dialog', { name: 'Freunde' })
  await dialog.getByRole('tab', { name: 'Profil' }).click()
  await dialog.getByRole('button', { name: 'Persönlichen Link kopieren' }).click()
  await expect(dialog.getByRole('button', { name: 'Link kopiert' })).toBeVisible()
  const link = await page.evaluate(() => navigator.clipboard.readText())
  expect(link).toContain('#anmelden=')

  const second = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const other = await second.newPage()
  await other.goto(link)
  await expect(other.getByTestId('map')).toHaveAttribute('data-ready', '1', { timeout: 60_000 })
  await other.locator('.friends-btn').click()
  await other.getByRole('dialog', { name: 'Freunde' }).getByRole('tab', { name: 'Profil' }).click()
  await expect(other.getByRole('dialog', { name: 'Freunde' })).toContainText(`Angemeldet als ${name}`)
  expect(other.url()).not.toContain('anmelden')
  await second.close()
})

test('a link to a list opens it and leaves the address clean', async ({ page }) => {
  await open(page)
  await join(page, `Link${run}`)
  await page.locator('.friends-btn').click()
  const dialog = page.getByRole('dialog', { name: 'Freunde' })
  await dialog.getByRole('tab', { name: 'Listen' }).click()
  const title = `Gastgärten ${run}`
  await dialog.getByLabel('Titel der Liste').fill(title)
  await dialog.getByRole('button', { name: 'Liste anlegen' }).click()
  await expect(dialog.locator('.list-title')).toHaveText(title)
  await dialog.getByRole('button', { name: 'Schließen' }).click()
  const lists = await page.evaluate(async () => (await (await fetch('/api/state')).json()).lists as { id: string; title: string }[])
  const id = lists.find((l) => l.title === title)!.id
  await page.evaluate((listId) => { location.hash = `liste=${listId}` }, id)
  await expect(dialog.locator('.list-title')).toHaveText(title)
  await expect.poll(() => page.url()).not.toContain('liste=')
})

test('hearts set before joining come along, and name and password work on another browser', async ({ page, browser }) => {
  const name = `Herz${run}`
  await open(page)
  await pick(page, 'Café Bendl')
  const panel = page.getByLabel('Ausgewähltes Lokal')
  await panel.getByRole('button', { name: 'Merken' }).click()
  await myListsCount(page, 1)
  await join(page, name)
  await myListsCount(page, 1)

  const second = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const other = await second.newPage()
  await open(other)
  await other.locator('.friends-btn').click()
  const dialog = other.getByRole('dialog', { name: 'Freunde' })
  await dialog.getByRole('button', { name: 'Schon dabei' }).click()
  await dialog.getByLabel('Dein Name').fill(name)
  await dialog.getByLabel('Passwort').fill('falsch')
  await dialog.getByRole('button', { name: 'Anmelden' }).click()
  await expect(dialog.getByRole('alert')).toContainText('stimmt nicht')
  await dialog.getByLabel('Passwort').fill(PASSWORD)
  await dialog.getByRole('button', { name: 'Anmelden' }).click()
  await expect(dialog.getByRole('tab', { name: 'Profil' })).toBeVisible()
  await dialog.getByRole('button', { name: 'Schließen' }).click()
  await myListsCount(other, 1)

  // Removing the heart on one device reaches the other; it isn't added back from the copy here.
  await pick(other, 'Café Bendl')
  await other.getByLabel('Ausgewähltes Lokal').getByRole('button', { name: 'Gemerkt' }).click()
  await expect(other.locator('.my-bars .badge-count')).toHaveCount(0)
  await page.reload()
  await expect(page.getByTestId('map')).toHaveAttribute('data-ready', '1', { timeout: 60_000 })
  await expect(page.locator('.friends-btn')).toBeVisible()
  await expect(page.locator('.my-bars .badge-count')).toHaveCount(0)

  // Signing out takes the profile's hearts off the device.
  await other.locator('.friends-btn').click()
  await dialog.getByRole('tab', { name: 'Profil' }).click()
  other.on('dialog', (d) => d.accept())
  await dialog.getByRole('button', { name: 'Abmelden' }).click()
  await expect(dialog.getByRole('tab', { name: 'Mitmachen' })).toBeVisible()
  await second.close()
})

test('on a narrow phone the header keeps its two rows with a full heart', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 360, height: 740 }, hasTouch: true, isMobile: true })
  const page = await context.newPage()
  const ids = await page.goto('/data/bars.json').then((r) => r!.json()).then((b: { id: string }[] | { bars: { id: string }[] }) => (Array.isArray(b) ? b : b.bars).slice(0, 12).map((x) => x.id))
  await page.evaluate((list) => localStorage.setItem('merkliste', JSON.stringify(list)), ids)
  await open(page)
  await expect(page.locator('.my-bars .badge-count')).toHaveText('12')
  await expect(page.locator('.friends-btn')).toBeVisible()
  const top = async (selector: string) => (await page.locator(selector).boundingBox())!.y
  expect(Math.abs(await top('.friends-btn') - await top('.my-bars summary'))).toBeLessThan(6)
  expect(await top('.filter-menu summary')).toBeLessThan(70)
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360)
  await context.close()
})
