import { expect, test, type Page } from '@playwright/test'

test.setTimeout(60_000) // Real textured GLBs also run on software WebGL in CI.

const roomOf = (page: Page) => page.locator('[data-room3d]')
async function open(page: Page) {
  await page.goto('/?replay=3d')
  await page.getByRole('button', { name: 'Look around in 3D' }).click()
  await expect(roomOf(page).getByRole('status')).toHaveText('2 of 2 pieces in 3D · prices at recording', { timeout: 20_000 })
}

test('recorded 3D room loads real GLBs without a provider or backend request', async ({ page }) => {
  const errors: string[] = []
  const remote: string[] = []
  const meshes: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('response', (r) => { if (r.url().endsWith('.glb') && r.ok()) meshes.push(r.url()) })
  await page.route('**/*', (route) => {
    const url = new URL(route.request().url())
    if (url.origin !== 'http://127.0.0.1:4173' || /^\/(depth|model3d|turn|offer)(\/|$)/.test(url.pathname)) {
      remote.push(url.href)
      return route.abort()
    }
    return route.continue()
  })
  await open(page)
  await expect.poll(() => meshes.length).toBe(5)
  await expect(page.getByLabel('Tell Roomify what you need')).toHaveCount(0)
  const room = roomOf(page)
  const camera = room.getByRole('group', { name: 'Camera angle' })
  for (const side of ['Left', 'Right', 'Back', 'Top', 'Photo', 'Front']) {
    await camera.getByRole('button', { name: side, exact: true }).click()
    await expect(camera.getByRole('button', { name: side, exact: true })).toHaveAttribute('aria-pressed', 'true')
  }
  const canvas = room.locator('canvas')
  await canvas.focus()
  await page.keyboard.press('ArrowLeft')
  await expect(camera.getByRole('button', { name: 'Front', exact: true })).toHaveAttribute('aria-pressed', 'false')
  await page.keyboard.press('+')
  await page.keyboard.press('Home')
  await expect(camera.getByRole('button', { name: 'Front', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await room.getByRole('button', { name: 'Rotate the room', exact: true }).click()
  await expect(room.getByRole('button', { name: 'Pause rotation' })).toHaveAttribute('aria-pressed', 'true')
  await camera.getByRole('button', { name: 'Top', exact: true }).click()
  await expect(room.getByRole('button', { name: 'Rotate the room', exact: true })).toHaveAttribute('aria-pressed', 'false')
  await page.screenshot({ path: `test-results/3d-top-${page.viewportSize()!.width}.png` })
  await page.keyboard.press('Escape')
  await expect(room).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Look around in 3D' })).toBeFocused()
  await page.getByRole('button', { name: 'Look around in 3D' }).click()
  await expect(roomOf(page).getByRole('status')).toContainText('2 of 2 pieces in 3D', { timeout: 20_000 })
  await page.reload()
  await expect(page.getByRole('button', { name: 'Look around in 3D' })).toBeVisible()
  expect(remote).toEqual([])
  expect(errors).toEqual([])
})

test('inspect the sofa and lamp with the listing photo, known sizes and shop links', async ({ page }) => {
  await open(page)
  const room = roomOf(page)
  await room.getByRole('group', { name: 'Inspect a piece', exact: true }).getByRole('button', { name: 'Sofa · €599.00', exact: true }).click()
  await expect(room.getByText('W 254 cm · D 92 cm · H 64 cm')).toBeVisible()
  await expect(room.getByText('Reconstructed from 3 shop photos.', { exact: false })).toBeVisible()
  await expect(room.getByRole('img', { name: /SKEJBY/ })).toBeVisible()
  await expect(room.getByRole('link', { name: 'Open at jysk.gr' })).toHaveAttribute('href', /^https:\/\/jysk.gr\//)
  await page.screenshot({ path: `test-results/3d-sofa-${page.viewportSize()!.width}.png` })
  await room.getByRole('button', { name: 'Whole room' }).click()
  await room.getByRole('group', { name: 'Inspect a piece', exact: true }).getByRole('button', { name: 'Floor lamp · €95.00', exact: true }).click()
  await expect(room.getByText('H 168 cm', { exact: true })).toBeVisible()
  await expect(room.getByRole('link', { name: 'Open at ikea.gr' })).toHaveAttribute('href', /^https:\/\/www.ikea.gr\//)
  const exit = room.getByRole('button', { name: 'Exit full screen' })
  if (await exit.count()) await exit.click()
  await room.getByRole('button', { name: 'Expand 3D view' }).click()
  await expect(room).toHaveCSS('position', 'fixed')
  await expect(room).toHaveAttribute('aria-modal', 'true')
  expect(await page.evaluate(() => !!document.elementFromPoint(innerWidth - 25, 25)?.closest('[data-room3d]'))).toBe(true)
  await room.getByRole('button', { name: 'Top', exact: true }).focus()
  await page.keyboard.press('Tab')
  await expect(room.locator('canvas')).toBeFocused()
  await page.keyboard.press('Shift+Tab')
  await expect(room.getByRole('button', { name: 'Top', exact: true })).toBeFocused()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await room.getByRole('button', { name: 'Close the 3D view (Esc)' }).click()
  await expect(room).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Look around in 3D' })).toBeFocused()
  expect(await page.evaluate(() => document.body.style.overflow)).not.toBe('hidden')
})

test('a failed recorded model is a labelled photo fallback, and a failed shell can retry', async ({ page }) => {
  let fail = true
  await page.route('**/demo3d/scene.json', async (route) => {
    if (fail) return route.fulfill({ status: 503 })
    return route.continue()
  })
  await page.goto('/?replay=3d')
  await page.getByRole('button', { name: 'Look around in 3D' }).click()
  const room = roomOf(page)
  await expect(room.getByRole('alert')).toContainText("Couldn't load the recorded room")
  fail = false
  await page.route('**/demo3d/ba52b3bf665214dc.glb', (route) => route.fulfill({ status: 503 }))
  await room.getByRole('button', { name: 'Try again', exact: true }).click()
  await expect(room.getByRole('status')).toContainText('Shown flat: sofa', { timeout: 20_000 })
  await room.getByRole('group', { name: 'Inspect a piece', exact: true }).getByRole('button', { name: 'Sofa · €599.00', exact: true }).click()
  await expect(room.getByText('Shown as a flat photo: the 3D model was unavailable.')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(room).toHaveCount(0)
})
