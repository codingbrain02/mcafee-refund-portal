import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { sentryVitePlugin } from '@sentry/vite-plugin'

const sentrySourceMapsEnabled = Boolean(
  process.env.SENTRY_AUTH_TOKEN && process.env.SENTRY_ORG && process.env.SENTRY_PROJECT,
)

// https://vite.dev/config/
export default defineConfig({
  build: {
    sourcemap: sentrySourceMapsEnabled ? 'hidden' : false,
  },
  define: {
    'import.meta.env.VITE_APP_RELEASE': JSON.stringify(
      process.env.VITE_APP_RELEASE ?? process.env.VERCEL_GIT_COMMIT_SHA ?? '',
    ),
  },
  plugins: [
    react(),
    ...(sentrySourceMapsEnabled
      ? [
          sentryVitePlugin({
            authToken: process.env.SENTRY_AUTH_TOKEN,
            org: process.env.SENTRY_ORG,
            project: process.env.SENTRY_PROJECT,
            sourcemaps: { filesToDeleteAfterUpload: ['./dist/**/*.map'] },
            telemetry: false,
          }),
        ]
      : []),
  ],
})
