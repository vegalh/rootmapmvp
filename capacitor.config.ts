import type { CapacitorConfig } from '@capacitor/cli'

// The iOS app (Capacitor) loads the same `dist/` the website is built into. See docs/data-architecture-phase2.md,
// section 12. The bundle id is provisional until the app is registered with Apple.
const config: CapacitorConfig = {
  appId: 'com.rootmap.app',
  appName: 'RootMap',
  webDir: 'dist',
}

export default config
