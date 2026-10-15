import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { DataUnavailable } from './components/DataUnavailable'
import { initData } from './lib/data/store'
import { startCloud } from './lib/cloud/session'
import { startSpace } from './lib/cloud/space'
import { lockNativeZoom, platform } from './lib/platform'
import { startViewportTracking } from './lib/native'
import './index.css'

lockNativeZoom()
startViewportTracking()
// Styles that only apply inside the iOS app (no text-selection callouts on controls, for example).
if (platform.kind === 'ios') document.documentElement.classList.add('ios-app')

const root = ReactDOM.createRoot(document.getElementById('root')!)

// Saved data is loaded (and, once per device, moved from localStorage to IndexedDB) before the first render,
// so every screen reads it synchronously as before. A signed-in parent's own space opens instead of the guest
// space (only in builds with cloud features).
startSpace().then(initData).then(status => {
  root.render(
    <React.StrictMode>
      {status.mode === 'unavailable' ? <DataUnavailable /> : <App />}
    </React.StrictMode>,
  )
  // Restores a signed-in session when this build uses the cloud; does nothing otherwise (the default).
  if (status.mode !== 'unavailable') void startCloud()
})
