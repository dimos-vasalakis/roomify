import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { SnapPage } from './components/snap/SnapPage'

/** /snap/<code>: the phone's page behind the QR code. No login, no board. */
const snap = /^\/snap\/([\w-]{8,})\/?$/.exec(location.pathname)?.[1]

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {snap ? <SnapPage code={snap} /> : <App />}
  </StrictMode>,
)
