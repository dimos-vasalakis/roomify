/**
 * Crop a room photo to 3:2 landscape (centre crop) and cap it at 1536 × 1024, as a JPEG.
 * The stage, the price dots and the render all share this geometry (docs/API.md).
 */
export async function toRoomPhoto(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  const target = 3 / 2
  let sw = bitmap.width
  let sh = bitmap.height
  if (sw / sh > target) sw = Math.round(sh * target)
  else sh = Math.round(sw / target)
  const sx = Math.round((bitmap.width - sw) / 2)
  const sy = Math.round((bitmap.height - sh) / 2)
  const scale = Math.min(1, 1536 / sw)
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(sw * scale)
  canvas.height = Math.round(sh * scale)
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('This browser cannot prepare the photo.')
  ctx.drawImage(bitmap, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height)
  bitmap.close()
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('This browser cannot prepare the photo.'))), 'image/jpeg', 0.86),
  )
}
