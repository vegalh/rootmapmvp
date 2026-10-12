import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { DataUnavailable } from './components/DataUnavailable'
import { initData } from './lib/data/store'
import { startCloud } from './lib/cloud/session'
import './index.css'

const root = ReactDOM.createRoot(document.getElementById('root')!)

// Saved data is loaded (and, once per device, moved from localStorage to IndexedDB) before the first render,
// so every screen reads it synchronously as before.
initData().then(status => {
  root.render(
    <React.StrictMode>
      {status.mode === 'unavailable' ? <DataUnavailable /> : <App />}
    </React.StrictMode>,
  )
  // Restores a signed-in session when this build uses the cloud; does nothing otherwise (the default).
  if (status.mode !== 'unavailable') void startCloud()
})
