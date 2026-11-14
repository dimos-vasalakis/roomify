import type { Session } from '../types'

/* Sample rooms live in src/data/samples.local.ts with photos in public/samples/. Both are gitignored,
   so they stay on the machine that has them. Without them the app starts with one empty room. */
const local = import.meta.glob<{ SAMPLE_SESSIONS: Session[] }>('./*.local.ts', { eager: true })

export const SAMPLES: Session[] = Object.values(local)[0]?.SAMPLE_SESSIONS ?? []
export const HAS_SAMPLES = SAMPLES.length > 0
