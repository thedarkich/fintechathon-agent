import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import 'misans/lib/Normal/MiSansVF.min.css'
import './index.css'
import './site.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
