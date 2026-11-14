import { ImagePlus } from 'lucide-react'
import { QRCodeSVG } from 'qrcode.react'
import { useState } from 'react'

/** First run: drop a photo of the room, or scan to take one with a phone. */
export function PhotoDrop({ onPhoto }: { onPhoto: (url: string) => void }) {
  const [over, setOver] = useState(false)
  const take = (file?: File) => file && file.type.startsWith('image/') && onPhoto(URL.createObjectURL(file))

  return (
    <div className="absolute inset-0 grid grid-cols-1 gap-3 p-4 sm:grid-cols-[1fr_12rem]">
      <label
        onDragOver={(e) => {
          e.preventDefault()
          setOver(true)
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault()
          setOver(false)
          take(e.dataTransfer.files[0])
        }}
        className={`flex cursor-pointer flex-col items-center justify-center gap-3 rounded-card border border-dashed text-center transition-colors duration-150 ${over ? 'border-ink bg-surface' : 'border-control hover:border-ink'}`}
      >
        <ImagePlus size={20} strokeWidth={1.5} className="text-muted" />
        <span className="text-body font-medium">Drop a photo of the room</span>
        <span className="max-w-64 text-chrome text-muted">Stand in a corner and get the whole wall in. Landscape works best.</span>
        <span className="mt-1 inline-flex h-control items-center rounded-control bg-primary px-4 text-chrome font-medium text-surface">Choose photo</span>
        <input type="file" accept="image/*" className="sr-only" onChange={(e) => take(e.target.files?.[0])} />
      </label>
      <div className="hidden flex-col items-center justify-center gap-3 rounded-card bg-surface p-4 text-center sm:flex">
        <QRCodeSVG value={`${location.origin}/snap`} size={112} bgColor="#ffffff" fgColor="#0a0a0a" />
        <p className="text-chrome text-muted">Or scan to take it with your phone</p>
      </div>
    </div>
  )
}
