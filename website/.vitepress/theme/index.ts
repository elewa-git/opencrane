import DefaultTheme from 'vitepress/theme'
import type { Theme } from 'vitepress'
import { theme, useOpenapi } from 'vitepress-openapi/client'
import 'vitepress-openapi/dist/style.css'
import './custom.css'
import spec from '../../public/openapi.json' with { type: 'json' }

// Register the opencrane-server spec globally so the <OASpec /> component on the
// API reference page renders without a per-page :spec prop. The spec is copied in
// from apps/opencrane by scripts/sync-openapi.mjs; CI re-emits it and fails on drift.
export default {
  extends: DefaultTheme,
  enhanceApp({ app }) {
    // The spec declares the relative server `/api/v1` (correct for a self-hosted
    // product with no canonical host), which the renderer cannot resolve at build
    // time — so its request samples fall back to a bare host and omit the version
    // prefix. The page says so explicitly; do not "fix" it by hard-coding a host
    // into the emitted spec, which is the authoritative runtime contract.
    useOpenapi({ spec })
    theme.enhanceApp({ app })
  },
} satisfies Theme
