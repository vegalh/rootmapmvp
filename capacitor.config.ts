import type { CapacitorConfig } from '@capacitor/cli'

// The iOS app (Capacitor) loads the same `dist/` the website is built into. See docs/data-architecture-phase2.md,
// section 12. The bundle id is provisional until the app is registered with Apple.
const config: CapacitorConfig = {
  appId: 'com.rootmap.app',
  appName: 'RootMap',
  webDir: 'dist',
  // The app's cream background behind the web view, so launching never flashes white before the page paints.
  backgroundColor: '#fbf2e4',
}

export default config
