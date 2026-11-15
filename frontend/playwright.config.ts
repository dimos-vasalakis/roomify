import { defineConfig } from '@playwright/test'
import { writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/** The fake microphone: a second of a voice-like warble, then three seconds of quiet, on a loop. */
function fakeSpeech() {
  const rate = 16000
  const samples = rate * 4
  const data = Buffer.alloc(44 + samples * 2)
  data.write('RIFF', 0)
  data.writeUInt32LE(36 + samples * 2, 4)
  data.write('WAVEfmt ', 8)
  data.writeUInt32LE(16, 16)
  data.writeUInt16LE(1, 20)
  data.writeUInt16LE(1, 22)
  data.writeUInt32LE(rate, 24)
  data.writeUInt32LE(rate * 2, 28)
  data.writeUInt16LE(2, 32)
  data.writeUInt16LE(16, 34)
  data.write('data', 36)
  data.writeUInt32LE(samples * 2, 40)
  for (let i = 0; i < samples; i++) {
    const t = i / rate
    const v = t < 1 ? 0.5 * Math.sin(2 * Math.PI * (180 + 60 * Math.sin(2 * Math.PI * 3 * t)) * t) * (0.6 + 0.4 * Math.sin(2 * Math.PI * 5 * t)) : 0
    data.writeInt16LE(Math.round(v * 32767), 44 + i * 2)
  }
  const path = join(tmpdir(), 'roomify-fake-speech.wav')
  writeFileSync(path, data)
  return path
}

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:4173',
    trace: 'retain-on-failure',
    permissions: ['microphone'],
    launchOptions: { args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${fakeSpeech()}`] },
  },
  projects: [
    { name: 'desktop', use: { viewport: { width: 1440, height: 900 } } },
    { name: 'mobile', use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, reducedMotion: 'reduce' } },
  ],
  webServer: [
    { command: 'VITE_API_URL=http://127.0.0.1:8173 npm run dev -- --host 127.0.0.1 --port 4173 --strictPort', url: 'http://127.0.0.1:4173', reuseExistingServer: false },
    { command: 'cd ../backend && .venv/bin/uvicorn tests.e2e_app:app --host 127.0.0.1 --port 8173', url: 'http://127.0.0.1:8173/health', reuseExistingServer: false },
  ],
})
