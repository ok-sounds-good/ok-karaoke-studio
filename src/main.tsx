import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './styles.css'
import './shell.css'
import './inspector.css'
import './workspace.css'
import './identity.css'
import './shell-identity.css'
import './inspector-identity.css'
import './workspace-identity.css'
import './dialog-export.css'
import './timeline.css'
import './transport.css'
import './stage-rendering.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
