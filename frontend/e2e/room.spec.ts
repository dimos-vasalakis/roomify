import { test, expect, type Page } from '@playwright/test'

// Synthetic photo: browser tests never send personal photos to paid services.
const photo = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAlgAAAGQCAIAAAD9V4nPAAAF/UlEQVR4nO3VIQEAIADAMKB/ITLgyUMMxLcEd5/37AEAVet3AAD8ZIQApBkhAGlGCECaEQKQZoQApBkhAGlGCECaEQKQZoQApBkhAGlGCECaEQKQZoQApBkhAGlGCECaEQKQZoQApBkhAGlGCECaEQKQZoQApBkhAGlGCECaEQKQZoQApBkhAGlGCECaEQKQZoQApBkhAGlGCECaEQKQZoQApBkhAGlGCECaEQKQZoQApBkhAGlGCECaEQKQZoQApBkhAGlGCECaEQKQZoQApBkhAGlGCECaEQKQZoQApBkhAGlGCECaEQKQZoQApBkhAGlGCECaEQKQZoQApBkhAGlGCECaEQKQZoQApBkhAGlGCECaEQKQZoQApBkhAGlGCECaEQKQZoQApBkhAGlGCECaEQKQZoQApBkhAGlGCECaEQKQZoQApBkhAGlGCECaEQKQZoQApBkhAGlGCECaEQKQZoQApBkhAGlGCECaEQKQZoQApBkhAGlGCECaEQKQZoQApBkhAGlGCECaEQKQZoQApBkhAGlGCECaEQKQZoQApBkhAGlGCECaEQKQZoQApBkhAGlGCECaEQKQZoQApBkhAGlGCECaEQKQZoQApBkhAGlGCECaEQKQZoQApBkhAGlGCECaEQKQZoQApBkhAGlGCECaEQKQZoQApBkhAGlGCECaEQKQZoQApBkhAGlGCECaEQKQZoQApBkhAGlGCECaEQKQZoQApBkhAGlGCECaEQKQZoQApBkhAGlGCECaEQKQZoQApBkhAGlGCECaEQKQZoQApBkhAGlGCECaEQKQZoQApBkhAGlGCECaEQKQZoQApBkhAGlGCECaEQKQZoQApBkhAGlGCECaEQKQZoQApBkhAGlGCECaEQKQZoQApBkhAGlGCECaEQKQZoQApBkhAGlGCECaEQKQZoQApBkhAGlGCECaEQKQZoQApBkhAGlGCECaEQKQZoQApBkhAGlGCECaEQKQZoQApBkhAGlGCECaEQKQZoQApBkhAGlGCECaEQKQZoQApBkhAGlGCECaEQKQZoQApBkhAGlGCECaEQKQZoQApBkhAGlGCECaEQKQZoQApBkhAGlGCECaEQKQZoQApBkhAGlGCECaEQKQZoQApBkhAGlGCECaEQKQZoQApBkhAGlGCECaEQKQZoQApBkhAGlGCECaEQKQZoQApBkhAGlGCECaEQKQZoQApBkhAGlGCECaEQKQZoQApBkhAGlGCECaEQKQZoQApBkhAGlGCECaEQKQZoQApBkhAGlGCECaEQKQZoQApBkhAGlGCECaEQKQZoQApBkhAGlGCECaEQKQZoQApBkhAGlGCECaEQKQZoQApBkhAGlGCECaEQKQZoQApBkhAGlGCECaEQKQZoQApBkhAGlGCECaEQKQZoQApBkhAGlGCECaEQKQZoQApBkhAGlGCECaEQKQZoQApBkhAGlGCECaEQKQZoQApBkhAGlGCECaEQKQZoQApBkhAGlGCECaEQKQZoQApBkhAGlGCECaEQKQZoQApBkhAGlGCECaEQKQZoQApBkhAGlGCECaEQKQZoQApBkhAGlGCECaEQKQZoQApBkhAGlGCECaEQKQZoQApBkhAGlGCECaEQKQZoQApBkhAGlGCECaEQKQZoQApBkhAGlGCECaEQKQZoQApBkhAGlGCECaEQKQZoQApBkhAGlGCECaEQKQZoQApBkhAGlGCECaEQKQZoQApBkhAGlGCECaEQKQZoQApBkhAGlGCECaEQKQZoQApBkhAGlGCECaEQKQZoQApBkhAGlGCECaEQKQZoQApBkhAGlGCECaEQKQZoQApBkhAGlGCECaEQKQZoQApBkhAGlGCECaEQKQZoQApBkhAGlGCECaEQKQZoQApBkhAGlGCECaEQKQZoQApBkhAGlGCECaEQKQZoQApBkhAGlGCECaEQKQZoQApBkhAGlGCECaEQKQZoQApBkhAGlGCECaEQKQZoQApBkhAGlGCECaEQKQZoQApBkhAGlGCECaEQKQZoQApBkhAKPsAeo2BXps3gcAAAAAAElFTkSuQmCC', 'base64')
async function upload(page: Page) {
  await page.locator('input[type=file]').setInputFiles({ name: 'room.png', mimeType: 'image/png', buffer: photo })
  await expect(page.getByText('Change photo', { exact: true })).toBeVisible()
}
async function start(page: Page) {
  await page.goto('/?demo=1')
  await upload(page)
  await page.getByLabel('What does the room need?').fill('A desk for focused work')
  await page.getByRole('button', { name: 'Create my room', exact: true }).click()
}
async function rooms(page: Page) {
  if (page.viewportSize()!.width < 1024) await page.getByRole('button', { name: 'Rooms', exact: true }).click()
  else await page.getByRole('button', { name: 'Show rooms (Ctrl B)', exact: true }).click()
}

test.beforeEach(async ({ page }) => {
  page.on('pageerror', error => { throw error })
  await page.route(/https:\/\//, route => route.fulfill({ contentType: 'image/png', body: photo }))
})

test('landing, required photo, and independent new-room inputs', async ({ page }) => {
  await page.goto('/?replay=1')
  await expect(page.getByRole('heading', { name: 'Photograph a room. Get a basket you can actually buy.' })).toBeVisible()
  await page.getByRole('button', { name: 'Open the sample rooms' }).first().click()
  await expect(page.getByRole('button', { name: 'Create my room', exact: true })).toBeDisabled()
  await page.getByLabel('What does the room need?').fill('A desk for room one')
  await page.getByLabel('Budget', { exact: true }).fill('900')
  await page.getByRole('button', { name: 'New room', exact: true }).filter({ visible: true }).first().click()
  await expect(page.getByLabel('What does the room need?')).toHaveValue('')
  await expect(page.getByLabel('Budget', { exact: true })).toHaveValue('500')
})

test('multipart API and real agent stream; compare, refine, restore', async ({ page }) => {
  await start(page)
  await expect(page.getByRole('button', { name: 'Adjust the brief', exact: true })).toBeVisible()
  await expect(page.getByLabel('Receipt')).toContainText('A desk sized for your work corner.')
  await expect(page.getByRole('link', { name: 'View at IKEA', exact: true })).toHaveAttribute('href', /ikea.gr/)
  await expect(page.getByRole('button', { name: /walk in/i })).toHaveCount(0)
  await expect(page.getByLabel('Receipt')).toContainText('€219.00')
  await page.getByRole('button', { name: 'Compare', exact: true }).click()
  const slider = page.getByRole('slider')
  await expect(slider).toHaveAttribute('aria-valuenow', '50')
  await slider.focus()
  await page.keyboard.press('ArrowRight')
  await expect(slider).toHaveAttribute('aria-valuenow', '55')
  await page.keyboard.press('Escape')
  await expect(slider).toHaveCount(0)
  await page.getByRole('button', { name: 'Adjust the brief', exact: true }).click()
  await expect(page.getByLabel('What does the room need?')).toHaveValue('A desk for focused work')
  await page.getByLabel('What does the room need?').fill('A desk with warmer wood')
  await page.getByRole('button', { name: 'Create updated room' }).click()
  const say = page.getByLabel('Tell Roomify what to change')
  await expect(say).toBeVisible()
  await say.fill('How wide is the desk?')
  await page.getByRole('button', { name: 'Change it' }).click()
  const chat = page.getByLabel('Conversation with Roomify')
  await expect(chat).toContainText('How wide is the desk?')
  await expect(chat).toContainText('The desk is 140 cm wide.')
  await expect(page.getByLabel('Receipt')).toContainText('€219.00')  // a reply keeps the basket
  await page.reload()
  await expect(page.getByRole('button', { name: 'Compare', exact: true })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await expect(page.locator('[data-after]')).toHaveCount(0, { timeout: 8000 })
  await page.screenshot({ path: `test-results/result-${page.viewportSize()!.width}.png`, fullPage: true })
})

test('rename and delete the final room', async ({ page }) => {
  await page.goto('/?demo=1')
  await rooms(page)
  await page.getByRole('button', { name: 'Options for New room' }).click()
  await page.getByRole('menuitem', { name: 'Rename', exact: true }).click()
  await page.getByRole('textbox', { name: 'Room name' }).fill('Office Αθήνα')
  await page.getByRole('textbox', { name: 'Room name' }).press('Enter')
  await page.getByRole('button', { name: 'Options for Office Αθήνα' }).click()
  await page.getByRole('menuitem', { name: 'Delete…' }).click()
  await page.getByRole('button', { name: 'Delete room', exact: true }).click()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('New room')
})

test('bad replacement photo keeps the previous photo and shows an error', async ({ page }) => {
  await page.goto('/?demo=1')
  await upload(page)
  await page.locator('input[type=file]').setInputFiles({ name: 'bad.png', mimeType: 'image/png', buffer: Buffer.from('broken') })
  await expect(page.getByRole('alert')).toBeVisible()
  await expect(page.locator('[data-picture]')).toBeVisible()
})

test('HTTP failure preserves brief and allows retry', async ({ page }) => {
  await page.route('**/turn', route => route.fulfill({ status: 503, json: { detail: 'Designer temporarily unavailable.' } }))
  await start(page)
  await expect(page.getByRole('alert')).toContainText('Designer temporarily unavailable.')
  await expect(page.getByLabel('What does the room need?')).toHaveValue('A desk for focused work')
  await page.unroute('**/turn')
  await page.getByRole('button', { name: 'Create my room', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Adjust the brief', exact: true })).toBeVisible()
})

test('truncated stream fails with a working retry', async ({ page }) => {
  await page.route('**/turn', route => route.fulfill({ contentType: 'text/event-stream', body: 'id: 1\nevent: run.status\ndata: {"status":"running"}\n\n' }))
  await start(page)
  await expect(page.getByText('The connection ended before the agent finished. Try again.')).toBeVisible()
  await page.unroute('**/turn')
  await page.getByRole('button', { name: 'Try again', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Adjust the brief', exact: true })).toBeVisible()
})

test('CRLF and unknown future events preserve stream parsing', async ({ page }) => {
  await page.route('**/turn', route => route.fulfill({ contentType: 'text/event-stream', body: [
    'id: 1\r\nevent: run.status\r\ndata: {"status":"running"}',
    'id: 2\r\nevent: future.event\r\ndata: {}',
    'id: 3\r\nevent: error\r\ndata: {"message":"No suitable products found.","retryable":true}',
  ].join('\r\n\r\n') + '\r\n\r\n' }))
  await start(page)
  await expect(page.getByText('No suitable products found.', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Try again', exact: true })).toBeVisible()
})

test('replay never calls the configured offer API', async ({ page }) => {
  let offers = 0
  page.on('request', request => { if (/\/(offer|turn)$/.test(request.url())) offers++ })
  await page.goto('/?replay=1&demo=1')
  await upload(page)
  await page.getByLabel('What does the room need?').fill('A desk for focused work')
  await page.getByRole('button', { name: 'Create my room', exact: true }).click()
  await expect(page.getByText('How wide is the main wall in your photo?')).toBeVisible()
  await page.getByLabel('How wide is the main wall in your photo?').fill('20')
  await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeDisabled()
  await page.getByLabel('How wide is the main wall in your photo?').fill('160')
  await page.getByRole('button', { name: 'Send', exact: true }).click()
  await expect(page.getByText('How wide is the main wall in your photo?')).toHaveCount(0)
  expect(offers).toBe(0)
})
