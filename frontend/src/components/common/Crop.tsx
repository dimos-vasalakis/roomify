import type { Box } from '../../types'

type Props = { src: string; box: Box; alt: string; className?: string }

/** Shows one region of a 3:2 room photo, for product and viewpoint thumbnails. */
export function Crop({ src, box, alt, className = '' }: Props) {
  return (
    <div
      className={`relative overflow-hidden bg-raised ${className}`}
      style={{ aspectRatio: `${(box.w * 1.5) / box.h}` }}
    >
      <img
        src={src}
        alt={alt}
        draggable={false}
        className="absolute max-w-none select-none"
        style={{
          width: `${100 / box.w}%`,
          left: `${(-box.x / box.w) * 100}%`,
          top: `${(-box.y / box.h) * 100}%`,
        }}
      />
    </div>
  )
}
