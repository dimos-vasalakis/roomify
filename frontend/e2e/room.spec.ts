import { test, expect, type Page } from '@playwright/test'

// Synthetic photo: browser tests never send personal photos to paid services.
const photo = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAlgAAAGQCAIAAAD9V4nPAAAF/UlEQVR4nO3VIQEAIADAMKB/ITLgyUMMxLcEd5/37AEAVet3AAD8ZIQApBkhAGlGCECaEQKQZoQApBkhAGlGCECaEQKQZoQApBkhAGlGCECaEQKQZoQApBkhAGlGCECaEQKQZoQApBkhAGlGCECaEQKQZoQApBkhAGlGCECaEQKQZoQApBkhAGlGCECaEQKQZoQApBkhAGlGCECaEQKQZoQApBkhAGlGCECaEQKQZoQApBkhAGlGCECaEQKQZoQApBkhAGlGCECaEQKQZoQApBkhAGlGCECaEQKQZoQApBkhAGlGCECaEQKQZoQApBkhAGlGCECaEQKQZoQApBkhAGlGCECaEQKQZoQApBkhAGlGCECaEQKQZoQApBkhAGlGCECaEQKQZoQApBkhAGlGCECaEQKQZoQApBkhAGlGCECaEQKQZoQApBkhAGlGCECaEQKQZoQApBkhAGlGCECaEQKQZoQApBkhAGlGCECaEQKQZoQApBkhAGlGCECaEQKQZoQApBkhAGlGCECaEQKQZoQApBkhAGlGCECaEQKQZoQApBkhAGlGCECaEQKQZoQApBkhAGlGCECaEQKQZoQApBkhAGlGCECaEQKQZoQApBkhAGlGCECaEQKQZoQApBkhAGlGCECaEQKQZoQApBkhAGlGCECaEQKQZoQApBkhAGlGCECaEQKQZoQApBkhAGlGCECaEQKQZoQApBkhAGlGCECaEQKQZoQApBkhAGlGCECaEQKQZoQApBkhAGlGCECaEQKQZoQApBkhAGlGCECaEQKQZoQApBkhAGlGCECaEQKQZoQApBkhAGlGCECaEQKQZoQApBkhAGlGCECaEQKQZoQApBkhAGlGCECaEQKQZoQApBkhAGlGCECaEQKQZoQApBkhAGlGCECaEQKQZoQApBkhAGlGCECaEQKQZoQApBkhAGlGCECaEQKQZoQApBkhAGlGCECaEQKQZoQApBkhAGlGCECaEQKQZoQApBkhAGlGCECaEQKQZoQApBkhAGlGCECaEQKQZoQApBkhAGlGCECaEQKQZoQApBkhAGlGCECaEQKQZoQApBkhAGlGCECaEQKQZoQApBkhAGlGCECaEQKQZoQApBkhAGlGCECaEQKQZoQApBkhAGlGCECaEQKQZoQApBkhAGlGCECaEQKQZoQApBkhAGlGCECaEQKQZoQApBkhAGlGCECaEQKQZoQApBkhAGlGCECaEQKQZoQApBkhAGlGCECaEQKQZoQApBkhAGlGCECaEQKQZoQApBkhAGlGCECaEQKQZoQApBkhAGlGCECaEQKQZoQApBkhAGlGCECaEQKQZoQApBkhAGlGCECaEQKQZoQApBkhAGlGCECaEQKQZoQApBkhAGlGCECaEQKQZoQApBkhAGlGCECaEQKQZoQApBkhAGlGCECaEQKQZoQApBkhAGlGCECaEQKQZoQApBkhAGlGCECaEQKQZoQApBkhAGlGCECaEQKQZoQApBkhAGlGCECaEQKQZoQApBkhAGlGCECaEQKQZoQApBkhAGlGCECaEQKQZoQApBkhAGlGCECaEQKQZoQApBkhAGlGCECaEQKQZoQApBkhAGlGCECaEQKQZoQApBkhAGlGCECaEQKQZoQApBkhAGlGCECaEQKQZoQApBkhAGlGCECaEQKQZoQApBkhAGlGCECaEQKQZoQApBkhAGlGCECaEQKQZoQApBkhAGlGCECaEQKQZoQApBkhAGlGCECaEQKQZoQApBkhAGlGCECaEQKQZoQApBkhAGlGCECaEQKQZoQApBkhAGlGCECaEQKQZoQApBkhAGlGCECaEQKQZoQApBkhAGlGCECaEQKQZoQApBkhAGlGCECaEQKQZoQApBkhAGlGCECaEQKQZoQApBkhAGlGCECaEQKQZoQApBkhAGlGCECaEQKQZoQApBkhAGlGCECaEQKQZoQApBkhAGlGCECaEQKQZoQApBkhAGlGCECaEQKQZoQApBkhAGlGCECaEQKQZoQApBkhAGlGCECaEQKQZoQApBkhAKPsAeo2BXps3gcAAAAAAElFTkSuQmCC', 'base64')

const phone = (page: Page) => page.viewportSize()!.width < 1024

/** A fresh room, whatever the app opened on (local sample rooms may be first). */
async function newRoom(page: Page, url = '/?demo=1') {
  await page.goto(url)
  await page.getByRole('button', { name: 'New room', exact: true }).filter({ visible: true }).first().click()
  await expect(page.getByText('Drop a photo of your room')).toBeVisible()
}
async function upload(page: Page) {
  await page.locator('input[type=file]').setInputFiles({ name: 'room.png', mimeType: 'image/png', buffer: photo })
  await expect(page.getByText('Change photo', { exact: true })).toBeVisible()
}
const composer = (page: Page) => page.getByLabel('Tell Roomify what you need')
async function say(page: Page, text: string) {
  await composer(page).fill(text)
  await page.getByRole('button', { name: 'Send', exact: true }).click()
}
async function start(page: Page, url?: string) {
  await newRoom(page, url)
  await upload(page)
  await say(page, 'A desk for focused work, €600')
}
async function rooms(page: Page) {
  if (phone(page)) await page.getByRole('button', { name: /^Rooms/ }).click()
  else await page.getByRole('button', { name: 'All rooms', exact: true }).click()
}
const done = (page: Page) => expect(page.getByRole('slider', { name: 'Before and after' })).toBeVisible({ timeout: 15_000 })

test.beforeEach(async ({ page }) => {
  page.on('pageerror', error => { throw error })
  await page.route(/https:\/\//, route => route.fulfill({ contentType: 'image/png', body: photo }))
})

test('empty room: a photo comes first, and a new room starts clean', async ({ page }) => {
  await newRoom(page)
  await expect(page.getByText('What do you need, and what’s the budget?')).toBeVisible()
  await say(page, 'A desk for room one')
  await expect(page.getByRole('status')).toHaveText('Add a photo of the room first.')
  await composer(page).fill('A desk for room one')
  await page.getByRole('button', { name: /^Budget/ }).click()
  await page.getByLabel('Budget in euros').fill('900')
  await page.getByLabel('Budget in euros').press('Enter')
  await expect(page.getByRole('button', { name: /^Budget/ })).toHaveText('Budget €900.00')
  await page.getByRole('button', { name: 'New room', exact: true }).filter({ visible: true }).first().click()
  await expect(composer(page)).toHaveValue('')
  await expect(page.getByRole('button', { name: /^Budget/ })).toHaveText('Budget €500.00')
})

test('real agent stream: steps, before/after, pins, a reply, and restore', async ({ page }) => {
  await start(page)
  const chat = page.getByLabel('Conversation with Roomify')
  await expect(chat).toContainText('A desk for focused work, €600')
  await done(page)

  // The total and its budget came from the brief; the agent's choice is a pin on the render.
  await expect(chat).toContainText('€219.00')
  await expect(chat).toContainText('of €600.00')
  const slider = page.getByRole('slider', { name: 'Before and after' })
  await expect(slider).toHaveAttribute('aria-valuenow', '0')
  await slider.focus()
  await page.keyboard.press('ArrowRight')
  await expect(slider).toHaveAttribute('aria-valuenow', '5')
  await page.keyboard.press('Home')

  await page.locator('[data-pin]').first().click()
  const card = page.getByRole('dialog')
  await expect(card).toContainText('€219.00')
  await expect(card.getByRole('link', { name: /View in shop/ })).toHaveAttribute('href', /ikea\.gr/)
  await card.getByRole('button', { name: 'Swap' }).click()
  await expect(composer(page)).toHaveValue('Swap the desk: ')

  // Real conversations have no walk-in yet.
  await expect(page.getByRole('button', { name: /walk in/i })).toHaveCount(0)

  // A question gets a reply and keeps the basket.
  await say(page, 'How wide is the desk?')
  await expect(chat).toContainText('The desk is 140 cm wide.')
  await expect(chat).toContainText('€219.00')

  await page.reload()
  await done(page)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: `test-results/result-${page.viewportSize()!.width}.png`, fullPage: true })
})

test('delete the final room leaves a fresh one', async ({ page }) => {
  await page.goto('/?demo=1')
  await rooms(page)
  const panel = page.getByRole('dialog', { name: 'Rooms' })
  for (;;) {
    const del = panel.getByRole('button', { name: /^Delete / })
    if ((await del.count()) <= 1) break
    await del.first().click()
  }
  await panel.getByRole('button', { name: /^Delete / }).click()
  await expect(panel.getByRole('button', { name: 'New room Not started' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByText('Drop a photo of your room')).toBeVisible()
})

test('bad replacement photo keeps the previous photo and shows an error', async ({ page }) => {
  await newRoom(page)
  await upload(page)
  await page.locator('input[type=file]').setInputFiles({ name: 'bad.png', mimeType: 'image/png', buffer: Buffer.from('broken') })
  await expect(page.getByRole('alert')).toBeVisible()
  await expect(page.locator('[data-picture]')).toBeVisible()
})

test('HTTP failure keeps the brief and allows a retry', async ({ page }) => {
  await page.route('**/turn', route => route.fulfill({ status: 503, json: { detail: 'Designer temporarily unavailable.' } }))
  await start(page)
  await expect(page.getByRole('alert')).toContainText('Designer temporarily unavailable.')
  await expect(composer(page)).toHaveValue('A desk for focused work, €600')
  await page.unroute('**/turn')
  await page.getByRole('button', { name: 'Send', exact: true }).click()
  await done(page)
})

test('truncated stream fails with a working retry', async ({ page }) => {
  await page.route('**/turn', route => route.fulfill({ contentType: 'text/event-stream', body: 'id: 1\nevent: run.status\ndata: {"status":"running"}\n\n' }))
  await start(page)
  await expect(page.locator('p', { hasText: 'The connection ended before the agent finished. Try again.' })).toBeVisible()
  await page.unroute('**/turn')
  await page.getByRole('button', { name: 'Try again', exact: true }).click()
  await done(page)
})

test('CRLF and unknown future events preserve stream parsing', async ({ page }) => {
  await page.route('**/turn', route => route.fulfill({ contentType: 'text/event-stream', body: [
    'id: 1\r\nevent: run.status\r\ndata: {"status":"running"}',
    'id: 2\r\nevent: future.event\r\ndata: {}',
    'id: 3\r\nevent: error\r\ndata: {"message":"No suitable products found.","retryable":true}',
  ].join('\r\n\r\n') + '\r\n\r\n' }))
  await start(page)
  await expect(page.locator('p', { hasText: 'No suitable products found.' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Try again', exact: true })).toBeVisible()
})

test('replay never calls the configured offer API', async ({ page }) => {
  let offers = 0
  page.on('request', request => { if (/\/(offer|turn)$/.test(request.url())) offers++ })
  await start(page, '/?replay=1&demo=1')
  const chat = page.getByLabel('Conversation with Roomify')
  await expect(chat).toContainText('How wide is the main wall in your photo?')
  await say(page, '20')
  await expect(page.getByRole('status')).toContainText('Say or type the width')
  await say(page, '160')
  await expect(chat).not.toContainText('How wide is the main wall in your photo?')
  await expect(page.getByText('Reading your room', { exact: true })).toBeVisible()
  expect(offers).toBe(0)
})

test('the rooms rail hides completely and comes back', async ({ page }) => {
  test.skip(phone(page), 'The rail is a desktop feature')
  await page.goto('/?demo=1')
  await page.keyboard.press('Control+b')
  await expect(page.getByRole('navigation', { name: 'Rooms' })).not.toBeInViewport()
  await page.reload()
  await page.getByRole('button', { name: 'Show rooms (Ctrl B)' }).click()
  await expect(page.getByRole('navigation', { name: 'Rooms' })).toBeInViewport()
})

test('voice without the browser\'s recogniser: recorded, ends on silence, transcribed by the server', async ({ page }) => {
  test.skip(phone(page), 'Same code path on phones; the fake microphone is set up for desktop')
  // Firefox, Brave and in-app browsers: no speech recognition of their own.
  await page.addInitScript(() => {
    delete (window as { webkitSpeechRecognition?: unknown }).webkitSpeechRecognition
    delete (window as { SpeechRecognition?: unknown }).SpeechRecognition
  })
  await start(page)
  await done(page)
  const sent = page.waitForRequest(/\/transcribe$/)
  await page.getByRole('button', { name: 'Talk to Roomify' }).click()
  await expect(page.getByRole('button', { name: 'Stop and send' })).toBeVisible()
  // Nobody presses stop: the quiet after the "sentence" ends it.
  await sent
  const chat = page.getByLabel('Conversation with Roomify')
  await expect(chat).toContainText('How wide is the desk?', { timeout: 10_000 })
  await expect(chat).toContainText('The desk is 140 cm wide.')
  await expect(page.getByRole('button', { name: 'Talk to Roomify' })).toBeEnabled()
})

test('voice with the browser\'s recogniser: live caption, sent without a server round trip', async ({ page }) => {
  test.skip(phone(page), 'Phones use the recording only')
  await page.addInitScript(() => {
    class FakeRecognition {
      lang = 'en-US'
      interimResults = false
      continuous = false
      onresult: ((e: unknown) => void) | null = null
      onerror: ((e: unknown) => void) | null = null
      onend: (() => void) | null = null
      start() {
        setTimeout(() => this.onresult?.({ results: [{ isFinal: false, 0: { transcript: 'How wide' } }] }), 150)
        setTimeout(() => this.onresult?.({ results: [{ isFinal: true, 0: { transcript: 'How wide is the desk?' } }] }), 400)
      }
      stop() {
        setTimeout(() => this.onend?.(), 50)
      }
      abort() {
        this.onend?.()
      }
    }
    const w = window as unknown as { webkitSpeechRecognition: unknown; SpeechRecognition: unknown }
    w.SpeechRecognition = w.webkitSpeechRecognition = FakeRecognition
  })
  let transcribed = 0
  page.on('request', (r) => void (/\/transcribe$/.test(r.url()) && transcribed++))
  await start(page)
  await done(page)
  await page.getByRole('button', { name: 'Talk to Roomify' }).click()
  await expect(composer(page)).toHaveValue(/How wide/)
  const chat = page.getByLabel('Conversation with Roomify')
  await expect(chat).toContainText('The desk is 140 cm wide.', { timeout: 10_000 })
  expect(transcribed).toBe(0)
})

test('Escape while listening throws the sentence away', async ({ page }) => {
  test.skip(phone(page), 'Keyboard only')
  await start(page)
  await done(page)
  let transcribed = 0
  page.on('request', (r) => void (/\/transcribe$/.test(r.url()) && transcribed++))
  await page.getByRole('button', { name: 'Talk to Roomify' }).click()
  await expect(page.getByRole('button', { name: 'Stop and send' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('button', { name: 'Talk to Roomify' })).toBeVisible()
  await page.waitForTimeout(2500)
  expect(transcribed).toBe(0)
  await expect(page.getByLabel('Conversation with Roomify')).not.toContainText('How wide is the desk?')
})

test('a photo taken on the phone lands on the laptop, and a retake replaces it', async ({ page, context }) => {
  test.skip(phone(page), 'The QR code is for the laptop screen')
  await newRoom(page)
  const href = await page.getByRole('link', { name: 'Link for your phone' }).getAttribute('href')
  expect(href).toMatch(/\/snap\/[\w-]{16}$/)
  const handset = await context.newPage()
  await handset.setViewportSize({ width: 390, height: 844 })
  await handset.goto(href!)
  await expect(handset.getByRole('heading', { name: 'Photograph the room' })).toBeVisible()
  await handset.locator('input[type=file]').first().setInputFiles({ name: 'room.png', mimeType: 'image/png', buffer: photo })
  await expect(handset.getByText('Sent. It’s on your laptop now.')).toBeVisible()
  await expect(page.getByText('Change photo', { exact: true })).toBeVisible({ timeout: 10_000 })
  await say(page, 'A desk for focused work, €600')
  await done(page)
})

test('an expired phone link says so in words', async ({ page }) => {
  await page.goto('/snap/expiredcode1234567')
  await page.locator('input[type=file]').first().setInputFiles({ name: 'room.png', mimeType: 'image/png', buffer: photo })
  await expect(page.getByRole('alert')).toHaveText('This code has expired. Scan the new QR code on the laptop.')
})

/* Foolproofing: every mistake and every failure has a way back. */

const budgetButton = (page: Page) => page.getByRole('button', { name: /^of €/ })

test('the budget can be changed after the room is done, and a bad value is refused', async ({ page }) => {
  await start(page)
  await done(page)
  await budgetButton(page).click()
  await page.getByLabel('Budget in euros').fill('5')
  await page.getByLabel('Budget in euros').press('Enter')
  await expect(page.getByRole('alert').filter({ hasText: 'A budget starts at €20.00.' })).toBeVisible()
  await page.getByLabel('Budget in euros').press('Escape')
  await expect(budgetButton(page)).toHaveText('of €600.00')
  await budgetButton(page).click()
  await page.getByLabel('Budget in euros').fill('900')
  await page.getByLabel('Budget in euros').press('Enter')
  await expect(budgetButton(page)).toHaveText('of €900.00')
})

test('over budget offers a way out instead of a red number', async ({ page }) => {
  await start(page)
  await done(page)
  await budgetButton(page).click()
  await page.getByLabel('Budget in euros').fill('100')
  await page.getByLabel('Budget in euros').press('Enter')
  await expect(page.getByText('€119.00 over')).toBeVisible()
  await page.getByRole('button', { name: 'Raise budget to €220.00' }).click()
  await expect(budgetButton(page)).toHaveText('of €220.00')
  await expect(page.getByRole('button', { name: /Bring it under/ })).toHaveCount(0)
})

test('undo goes back to the room before the last message, with the message back in the box', async ({ page }) => {
  await start(page)
  await done(page)
  const chat = page.getByLabel('Conversation with Roomify')
  await say(page, 'How wide is the desk?')
  await expect(chat).toContainText('The desk is 140 cm wide.')
  await page.getByRole('button', { name: 'Undo', exact: true }).click()
  await expect(chat).not.toContainText('The desk is 140 cm wide.')
  await expect(composer(page)).toHaveValue('How wide is the desk?')
  await expect(page.getByText(/Back to the room before/)).toBeVisible()
  await done(page) // the finished room is still there
})

test('stop while the agent works puts the room back as it was', async ({ page }) => {
  await start(page)
  await done(page)
  await page.route(/\/turn$/, () => undefined) // the agent never answers
  await say(page, 'Add a rug under the desk')
  const stop = page.getByRole('button', { name: 'Stop Roomify' })
  await expect(stop).toBeVisible()
  // Typing the next message while it works is allowed; it is kept.
  await composer(page).fill('and a lamp')
  await stop.click()
  await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeVisible()
  await done(page)
  await expect(composer(page)).toHaveValue('Add a rug under the desk')
})

test('a run that fails halfway never loses the room before it', async ({ page }) => {
  await start(page)
  await done(page)
  await page.route(/\/turn$/, (route) =>
    route.fulfill({
      contentType: 'text/event-stream',
      body: 'id: 1\nevent: message\ndata: {"text":"Starting over.","action":"design"}\n\nid: 2\nevent: error\ndata: {"message":"The design service could not finish this step."}\n\n',
    }),
  )
  await say(page, 'Start over with a sofa')
  await expect(page.getByText('The design service could not finish this step.')).toBeVisible()
  await page.getByRole('button', { name: 'Back to the last room' }).click()
  await done(page)
  await expect(page.getByLabel('Conversation with Roomify')).toContainText('€219.00')
})

test('a deleted room comes back with Undo', async ({ page }) => {
  await start(page)
  await done(page)
  const name = await page.getByLabel('Conversation with Roomify').locator('header').innerText()
  await rooms(page)
  await page.getByRole('button', { name: /^Delete Desk/ }).click({ force: true })
  await page.getByRole('button', { name: 'Undo', exact: true }).click()
  await done(page)
  expect(name).toContain('€219.00')
})

test('reloading mid-run never leaves a room stuck working', async ({ page }) => {
  test.skip(phone(page), 'Same logic on phones')
  await start(page)
  await done(page)
  await page.route(/\/turn$/, () => undefined)
  await say(page, 'Add a rug under the desk')
  await expect(page.getByRole('button', { name: 'Stop Roomify' })).toBeVisible()
  page.on('dialog', (d) => void d.accept()) // "Leave site?" while it works
  await page.reload()
  await expect(page.getByText('The page was reloaded before Roomify finished.')).toBeVisible()
  await page.getByRole('button', { name: 'Back to the last room' }).click()
  await done(page)
})

test('a wall width is understood in cm or metres', async ({ page }) => {
  await page.goto('/?demo=1')
  const widths = await page.evaluate(async () => {
    const { widthIn } = await import('/src/lib/match.ts')
    return ['160', '160 cm', '1.6 m', '3,2m', '3', 'about 2.5 metres', '12', 'a lot'].map(widthIn)
  })
  expect(widths).toEqual([160, 160, 160, 320, 300, 250, null, null])
})

test('a budget said in words changes the budget, with the sums done right', async ({ page }) => {
  await start(page)
  await done(page)
  await say(page, 'I can spend 300 more')
  const chat = page.getByLabel('Conversation with Roomify')
  await expect(chat).toContainText('Your budget is now €900. Your pieces come to €219, so €681 is left.')
  await expect(page.getByRole('button', { name: /^of €/ })).toHaveText('of €900.00')
  await say(page, 'lower the budget to 150')
  await expect(chat).toContainText('€69 over. Want me to make it fit?')
  await expect(page.getByRole('button', { name: /Bring it under €150.00/ })).toBeVisible()
})
