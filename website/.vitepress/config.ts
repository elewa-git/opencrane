import { defineConfig } from 'vitepress'

// Served at the opencrane.ai custom domain (see website/public/CNAME), so base
// stays '/'. DOCS_BASE can override it (e.g. '/opencrane/') for project-pages hosting.
const base = process.env.DOCS_BASE ?? '/'

const REPO = 'https://github.com/elewa-git/opencrane'

export default defineConfig({
  base,
  lang: 'en-GB',
  title: 'OpenCrane',
  description:
    'Self-hosted, Kubernetes-native control plane for governed organisational AI agents.',
  cleanUrls: true,
  lastUpdated: true,
  // Architecture diagrams in the docs use Unicode box-drawing; keep them intact.
  ignoreDeadLinks: false,

  head: [
    // base-aware so the favicon resolves under project pages (/opencrane/) too.
    ['link', { rel: 'icon', type: 'image/svg+xml', href: `${base}logo.svg` }],
    ['meta', { name: 'theme-color', content: '#14a8c4' }],
  ],

  themeConfig: {
    logo: '/logo.svg',
    search: { provider: 'local' },

    nav: [
      { text: 'Start here', link: '/guide/introduction' },
      {
        text: 'Guides',
        items: [
          { text: 'Set up your personal assistant', link: '/guide/persona' },
          { text: 'Create a managed agent', link: '/guide/first-agent' },
          { text: 'Organize your company', link: '/guide/organize' },
          { text: 'Agent skills', link: '/guide/skills' },
          { text: 'Agent delegation (child runs)', link: '/guide/child-runs' },
          { text: 'Manage tools (MCP)', link: '/guide/tools' },
          { text: 'Organizational knowledge', link: '/guide/knowledge' },
          { text: 'Control access', link: '/guide/permissions' },
          { text: 'Manage cost', link: '/guide/budgets' },
          { text: 'Model routing', link: '/guide/model-routing' },
        ],
      },
      {
        text: 'Reference',
        items: [
          { text: 'API reference', link: '/reference/api' },
          { text: 'API overview', link: '/reference/api-overview' },
        ],
      },
      { text: 'Contributing', link: '/contributing/overview' },
      { text: 'GitHub', link: REPO },
    ],

    sidebar: [
      {
        text: 'Start here',
        items: [
          { text: 'What is OpenCrane?', link: '/guide/introduction' },
          { text: 'How OpenCrane works', link: '/guide/how-it-works' },
        ],
      },
      {
        text: 'Get set up',
        items: [
          {
            text: '1. Install OpenCrane',
            link: '/guide/getting-started',
            items: [
              { text: 'Local, VM or VPS', link: '/guide/deploy-local' },
              { text: 'Cluster deployment', link: '/guide/deploy-cluster' },
            ],
          },
          { text: '2. Set up your domain', link: '/guide/dns' },
          { text: '3. Set up your personal assistant', link: '/guide/persona' },
        ],
      },
      {
        text: 'Guides',
        items: [
          { text: 'Set up your personal assistant', link: '/guide/persona' },
          { text: 'Create a managed agent', link: '/guide/first-agent' },
          { text: 'Organize your company', link: '/guide/organize' },
          { text: 'Agent skills', link: '/guide/skills' },
          { text: 'Agent delegation (child runs)', link: '/guide/child-runs' },
          { text: 'Manage tools (MCP)', link: '/guide/tools' },
          { text: 'Organizational knowledge', link: '/guide/knowledge' },
          { text: 'Control who can access what', link: '/guide/permissions' },
          { text: 'Manage cost', link: '/guide/budgets' },
          { text: 'Model routing & auto-routing', link: '/guide/model-routing' },
          { text: 'Review activity', link: '/guide/audit' },
        ],
      },
      {
        text: 'Reference',
        items: [
          { text: 'API reference', link: '/reference/api' },
          { text: 'API overview', link: '/reference/api-overview' },
          { text: 'Contracts SDK', link: '/integrators/contracts-sdk' },
        ],
      },
      {
        text: 'Operating OpenCrane',
        collapsed: true,
        items: [
          { text: 'Hosting & deployment', link: '/operators/hosting' },
          { text: 'Deployment configuration', link: '/operators/deployment-configuration' },
          { text: 'Organisation boundary', link: '/operators/organisation-boundary' },
          { text: 'DNS configuration', link: '/operators/dns-config' },
          { text: 'Networking & isolation', link: '/operators/networking' },
          { text: 'Identity & network isolation (Cilium + SPIFFE)', link: '/operators/cilium-spiffe-identity' },
          { text: 'Identity & runtime auth', link: '/security/identity' },
          { text: 'Runbook', link: '/operators/runbook' },
          { text: 'Telemetry & logging', link: '/operators/telemetry-logging' },
        ],
      },
      {
        text: 'Deep dives',
        collapsed: true,
        items: [
          { text: 'Governed agent runtime', link: '/integrators/agent-runtime' },
          { text: 'MCP gateway (Obot)', link: '/integrators/mcp-gateway' },
          { text: 'Memory write, manage & read', link: '/integrators/retrieval-memory' },
          { text: 'Long-term memory & dreaming', link: '/integrators/long-term-memory-cognee' },
          { text: 'Silo IAM: inheritance & sharing', link: '/integrators/silo-iam' },
        ],
      },
      {
        text: 'Advanced',
        collapsed: true,
        items: [
          { text: 'Architecture', link: '/advanced/architecture' },
          { text: 'Running multiple instances', link: '/advanced/multi-instance' },
        ],
      },
      {
        text: 'Contributing',
        collapsed: true,
        items: [
          { text: 'Overview', link: '/contributing/overview' },
          { text: 'The CI pipeline', link: '/contributing/ci-pipeline' },
          { text: 'Deploying', link: '/contributing/deploying' },
          { text: 'Versions and migrations', link: '/contributing/versions-and-migrations' },
          { text: 'Letting an AI agent manage your deployment', link: '/contributing/ai-managed-deployment' },
        ],
      },
    ],

    socialLinks: [{ icon: 'github', link: REPO }],

    editLink: {
      pattern: `${REPO}/edit/main/website/:path`,
      text: 'Edit this page on GitHub',
    },

    footer: {
      message: 'Released under the AGPL-3.0-or-later License.',
      copyright: 'OpenCrane — self-hosted control plane for organizational AI.',
    },
  },
})
