import { createRoot } from 'react-dom/client'
import '@fontsource/inter/400.css'
import '@fontsource/inter/600.css'
import '@fontsource/orbitron/600.css'
import '@fontsource/orbitron/800.css'
import './index.css'
import './app/hooks/useTheme'
import './ai/registerLLM'   
import App from './app/App.tsx'

createRoot(document.getElementById('root')!).render(
  <App />
)