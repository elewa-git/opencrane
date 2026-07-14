# Handoff: OpenCrane UI — Session + Settings

## Overview

This handoff covers two primary views of the OpenCrane web app:

1. **Session** — the main AI chat interface where users interact with their agentic workspace
2. **Settings** — a two-level configuration panel (Workspace + Personal) covering members, budgets, skills, channels, data governance, AI provider keys, and account preferences

The design is a high-fidelity prototype. Files in this package are **HTML design references** — not production code to ship directly. The task is to recreate these screens in your existing codebase (React, Next.js, or equivalent) using established patterns and libraries.

---

## Fidelity

**High-fidelity.** Pixel-precise colors, typography, spacing, and interactions. Recreate the UI to match visually, applying your codebase's component primitives and routing patterns.

---

## Design Language

### Colors

| Token | Hex | Usage |
|---|---|---|
| `surface-app` | `#1a1918` | App background, sidebar, dark cards |
| `surface-sidebar-secondary` | `#141312` | Sidebar active row background |
| `surface-content` | `#f3f0ea` | Main content area background |
| `surface-settings-nav` | `#ebe8e2` | Settings left nav |
| `surface-card` | `#fff` | Cards, inputs |
| `surface-row-alt` | `#f8f5ef` | Table header rows, alternating rows |
| `border-default` | `#dedad2` | Standard card/input borders |
| `border-subtle` | `#e8e5de` | Row dividers |
| `border-dark` | `rgba(255,255,255,.06)` | Sidebar borders |
| `text-primary` | `#1a1918` | Main body text |
| `text-secondary` | `#6a6660` | Secondary text |
| `text-muted` | `#9a9690` | Labels, placeholders |
| `text-faint` | `#b0ada8` | Hints, placeholder text |
| `text-sidebar-active` | `#fff` | Active session title |
| `text-sidebar-inactive` | `#7a7673` | Inactive session title |
| `text-sidebar-meta` | `#4a4845` | Sidebar dept/team labels |
| `text-sidebar-section` | `#3a3835` | Sidebar section headers |
| `accent-teal` | `#0db5cc` | Primary brand accent — CTAs, toggles on, active nav, wordmark |
| `accent-orange` | `#f47920` | Spark accent — New session, active dots, unread badges (matches logo beak) |
| `accent-red` | `#c1392b` | Danger only — Delete, Revoke, Remove, billing limit warnings |
| `accent-blue` | `#2a5c9a` | Avatar, role badge, retrieval citations |
| `accent-green` | `#2a7d4f` | Success, on-track budget |
| `accent-amber` | `#9a6b2a` | Policy citations, applied status |
| `scope-org-bg` | `#e8e8e4` | Scope badge: org |
| `scope-dept-bg` | `#fef0d0` | Scope badge: dept |
| `scope-project-bg` | `#e0f0e8` | Scope badge: project |
| `scope-personal-bg` | `#fce8e4` | Scope badge: personal |
| `tag-retrieval-bg` | `#ddeeff` | Citation type R |
| `tag-policy-bg` | `#fef0d0` | Citation type P |
| `tag-action-bg` | `#d8f0e4` | Citation type A |
| `role-admin-bg` | `#ddeeff` | Role chip: admin |
| `role-member-bg` | `#d8f0e4` | Role chip: member |
| `role-viewer-bg` | `#f0e8d0` | Role chip: viewer |
| `status-connected` | `#22c55e` | Channel connected dot |
| `toggle-on` | `#0db5cc` | Toggle active (teal) |
| `toggle-off` | `#cec9c3` | Toggle inactive |

### Typography

- **Primary font**: DM Sans (`opsz` 9–40, weights 300/400/500/600/700) — all UI text
- **Mono font**: DM Mono (400/500) — keys, code, contract badges, source references

| Role | Size | Weight | Notes |
|---|---|---|---|
| Page title | 26px | 600 | letter-spacing −0.5px |
| Sub-page title | 24px | 600 | letter-spacing −0.4px |
| Session header | 15px | 600 | letter-spacing −0.2px |
| Message text | 14.5–15px | 400 | line-height 1.65–1.7 |
| Body / row label | 13.5–14px | 400–500 | |
| Small label | 12–13px | 400 | |
| Section uppercase | 10–11px | 600 | letter-spacing 0.07–0.1em, uppercase |
| Code / mono | 11–13px | 400–500 | DM Mono |

### Spacing & Geometry

- Sidebar width: **192px**
- Settings nav width: **200px**
- Chat max-width: **700px** (centered)
- Settings content padding: `40px 52px 72px`
- Row padding (settings form): `17px 0`, with `1px solid #dedad2` bottom border
- Form grid: `260px 1fr` (label | control)
- Card border-radius: `10px`
- Input border-radius: `6px`
- Button border-radius: `6–7px`
- Toggle: `44×24px`, thumb `20×20px`, border-radius `12px`
- Avatar: `28–44px` circle
- Scrollbar width: `4px`, thumb `#d0cdc8`, no track

---

## Screen 1: Session View

### Layout

```
┌─────────────[192px sidebar]──────────┬────────────[flex:1 content]──────────┐
│ OpenCrane logo                        │ [48px header bar]                     │
│ + New session (red)                   │ Session title · dept badge · model    │
│ ─────────────────────────────────     │ ───────────────────────────────────── │
│ MY SESSIONS (label)                   │ [flex:1 scroll] chat messages         │
│ • Q3 strategy draft [2]  Product      │   max-width 700px, centered           │
│   swift-harbour          Engineering  │                                       │
│   frame-orchard [5]      Product      │ [input bar]                           │
│ SHARED (label)                        │   bg #fff, border, border-radius 12px │
│   weekly-tide            Marketing    │   + attach btn | textarea | send btn  │
│   lend-meadow            Finance      │ ───────────────────────────────────── │
│ ─────────────────────────────────     │ contract badge (centered, muted)      │
│ ⚙ Settings                            │                                       │
│ [avatar] Alex Kim  alex.oc · Product  │                                       │
└───────────────────────────────────────┴───────────────────────────────────────┘
```

### Sidebar

- Background `#1a1918`, right border `rgba(255,255,255,.06)`
- Logo: 14.5px/600, white
- **New session**: 13px, `#c1392b`, flex row with `+` SVG icon (12×12), border-radius 5px
- Session section headers: 10px/600, uppercase, letter-spacing 0.09em, `#3a3835`
- **Active session row**: bg `rgba(255,255,255,.07)`, border-radius 6px; title white 13px/500; dept 11px `#5a5855`; active dot 6px `#c1392b`; unread badge: `#c1392b` bg
- **Inactive session row**: title `#7a7673` 13px; dept `#4a4845` 11px
- **Settings link**: 13px, icon (⚙ SVG), `#6a6663` default / `#c1392b` when on settings page
- **Footer**: avatar circle 28px (`#2a5c9a`), name 12px/500 `#ccc`, meta 10.5px `#4a4845`

### Header Bar

- Height 48px, bg `#f3f0ea` (matches content), bottom border `#e0ddd6`
- Left: session name 15px/600 + dept badge (`#e8f0f8` bg, `#1d4d8a` text, 11.5px/500, border-radius 4px, padding 2px 8px)
- Right: model chip (border `#dedad2`, 12px text `#9a9690`) + Share button (same border style)

### Chat Messages

- Scrollable flex column, padding `32px 0 12px`
- **Assistant messages**: plain text, 15px, line-height 1.7, `white-space: pre-wrap`, margin-bottom 32px
  - Citation strips below text (see Citation component)
- **User messages**: flex row justify-end; bubble bg `#1a1918`, white text, 14.5px, line-height 1.6, border-radius `14px 14px 3px 14px`, padding `11px 16px`, max-width 72%, margin-bottom 28px

### Citation Strip

Each grounded fact renders as a horizontal strip:
- bg `#fff`, border `1px solid #e8e5de`, left accent `2.5px solid [type color]`, border-radius `0 7px 7px 0`
- padding `7px 11px`, flex row, gap 7px, flex-wrap
- **Type badge** (DM Mono, 10.5px/700, border-radius 3px): R=blue, P=amber, A=green
- **Title**: 12.5px `#3a3835`, flex:1
- **Scope badge**: 11px, colored bg by scope (org/dept/project/personal)
- **Source**: DM Mono 11px `#9a9690`
- **Status badge** (optional): 11px, border `1px solid [statusColor]`, text `[statusColor]` — states: applied, done, pending, resolved

### Input Bar

- Wrapper: bg `#fff`, border `1px solid #d8d4cd`, border-radius 12px, padding `10px 12px`, box-shadow `0 1px 4px rgba(0,0,0,.06)`
- Attach button: transparent, SVG icon `#b0ada8`, 16×16
- Textarea: flex:1, 14.5px, `#1a1918`, no border, transparent bg, line-height 1.55, max-height 140px
- Send button: bg `#1a1918`, border-radius 7px, padding `6px 9px`, arrow SVG white
- **Enter to send** (not Shift+Enter), auto-scroll to bottom on new message
- Contract line below: `contract v2.3.1 · org · dept · project · personal`, 11.5px `#b0ada8`, centered

---

## Screen 2: Settings View

### Layout

```
┌──[192px shared sidebar]──┬──[200px settings nav]──┬──[flex:1 content]───┐
│ (same as Session)         │ Settings label          │ padding 40 52 72    │
│                           │ [Workspace | Personal]  │ section content     │
│                           │  toggle                 │                     │
│                           │ nav items (icon+label)  │                     │
│                           │ ♾ self-hosted badge     │                     │
└───────────────────────────┴─────────────────────────┴─────────────────────┘
```

### Settings Nav

- Background `#ebe8e2`, right border `#dedad2`
- "Settings" label: 10px/600, uppercase, `#9a9690`
- **Workspace / Personal toggle**: segmented pill, bg `#dedad3`, border-radius 7px, padding 3px; active segment bg `#fff`, shadow `0 1px 2px rgba(0,0,0,.08)`, 12px/500; inactive 12px/400 `#8a8682`
- **Nav items**: flex row with SVG icon (13×13, opacity 0.65) + label text 13.5px; active: bg `#fff`, shadow `0 1px 3px rgba(0,0,0,.07)`, weight 500; inactive: transparent bg, `#6a6660`; border-radius 6px, padding `7px 10px`
- Self-hosted badge: `#8a8682` 10.5px, bg `rgba(0,0,0,.05)`, border-radius 6px

### Settings Form Pattern

Each settings section uses a consistent form layout:
- **Title**: 26px/600, letter-spacing −0.5px
- **Subtitle**: 14px, `#8a8682`, margin-bottom 28–32px
- **Field rows**: CSS grid `260px 1fr`, gap 24px, padding `17px 0`, bottom border `1px solid #dedad2`
  - Left: label 14px/500 + optional description 12.5px `#9a9690`
  - Right: control (input, select, toggle, etc.)
- **Save button**: bg `#1a1918`, white, border-radius 7px, padding `10px 20px`, 14px/500, right-aligned

### Workspace Sections

#### Pod
Fields: Pod ID (read-only mono), Display name (text input), OpenCrane version (mono input + latest label), Storage (mono address + Used/Quota/Encrypted stats grid), Auto-update (toggle).

#### Members
- Seat counter in subtitle: `{n} of {limit}` colored red if ≥80% filled
- Invite button disabled (bg `#e8e5df`, cursor not-allowed) when at billing limit; show upgrade banner (`#fef2ee` bg, red text)
- **People sub-tab**: grid `32px 1fr 90px 200px 72px`; avatar circle, name+email, role badge, spend progress bar (4px height, green/red by %), Edit button
- **Teams & Org sub-tab**: two tables — Departments & Teams tree, and Projects

**Org tree table**: grid `1fr 72px 80px 72px`
- Dept rows: bold 13.5px, chevron icon, bg `#fdfcfa`
- Team rows: indented `40px` left, arrow icon, 13px `#3a3835`, muted `#f0ede8` dividers

**Projects table**: grid `1fr 72px 80px 88px 72px`; status badge (green Active / muted Draft)

#### Budgets
- Summary card: 3-column grid (org spend, routing strategy select, reset date)
- Per-member table: grid `1fr 130px 110px 110px 72px`; number input for limit, spend amount, mini progress bar, status label

#### Skills
- Installed skills list: grid `1fr 80px 64px 52px`; name+category, category badge, version (DM Mono), on/off toggle
- "Browse marketplace" → marketplace sub-page

#### Channels
- Cards: grid `38px 1fr 140px 88px`; icon in `#f0ede8` bg square, name+handle (DM Mono), status dot + label, Configure button
- "Add channel" → add-channel sub-page

#### Data & Network
- Dark sovereignty banner: bg `#1a1918`, white text + green connected dot
- Scope datasets list: white card rows, Active badge
- Egress allowlist: white card rows, DM Mono domain + category label, "Add domain" link

#### AI Provider Keys
- Provider cards: provider name, connected dot, supported models list (12px `#9a9690`), Remove button (red border)
- Encrypted note footer
- "Add provider key" → add-provider-key sub-page

### Personal Sections

#### Account
Fields: profile picture (avatar + Change photo button), display name, email (read-only), role badge, notification checkboxes.

#### Awareness
Fields: fallback behaviour (select), citation mode (toggle), scope query order (read-only mono string `personal → project → dept → org`).

#### My Budget
- Large spend display: `$124 of $150`, 32px/600; percentage (red if ≥80%)
- 7px progress bar, `#c1392b` fill
- By-model-class table: name + model (12px), spend + percentage

#### My API Keys (Personal)
Empty state card with "Create your first key" CTA.

---

## Sub-Pages

Sub-pages replace the section content and share a common header:

- **Back button**: `← [Section name]`, 13.5px `#6a6660`, arrow SVG, no border
- All sub-pages have the same form field pattern as their parent section

### Edit Department
- Name input
- Teams in this dept list: name + member count + "Edit team →" button
- "+ New team in this department" link (red)
- Delete department (red border) + Save (dark) button row

### Edit Team
- Name input, department select
- Member checklist: avatar + name + email per row

### Edit Project
- Name input, status select (Active/Draft/Archived)
- Linked teams checklist
- Delete + Save button row

### Skills Marketplace
- Category filter pills: All / Memory / Dev / Productivity / Comms / Research / Data; active pill bg `#1a1918` white text; inactive `#f0ede8`
- Skill rows: grid `1fr 80px 80px 84px`; name + description (12.5px `#9a9690`), category badge, version, Install/Uninstall button (red border for installed)

### Add Channel
- Provider grid: 3 columns, cards with icon + name + desc; selected card bg `#1a1918`, white text, border `2px solid #1a1918`
- Config form appears below on selection: field label + text input, Test connection + Add channel buttons

### Add Provider Key
- Provider grid: 4 columns, card with name + supported models; same selection pattern as channels
- Config form: provider name, models in mono, API key password input + placeholder, Test + Save buttons

---

## Interactions & Behavior

### Navigation
- Sidebar Settings link switches `page` state: `'session'` ↔ `'settings'`
- Settings nav items set `section` state; switching section resets `subPage`, `subPageItem`, `selectedProvider`, `selectedChannelType` to null
- Sub-pages set `subPage` state; back button clears it
- Workspace/Personal toggle sets `tab` state, resets section to first item (`'pod'` / `'account'`)

### Chat
- Enter sends, Shift+Enter newlines
- On send: append user message, auto-scroll `#oc-chat` to bottom
- Input clears after send

### Toggles
- 44×24px pill; thumb animates left `2px` (off) → `22px` (on), bg `#cec9c3` → `#c1392b`; no JS transition library needed — CSS transition `left 0.14s ease, background 0.18s`

### Skill toggles
- Same toggle pattern; mutates skill `enabled` state in array

### Members billing gate
- When `memberCount >= memberLimit`: invite button disabled + styled muted; upgrade banner shown above sub-tabs

---

## State Shape

```ts
// Top level
page: 'session' | 'settings'

// Session
messages: Array<{
  id: number
  role: 'user' | 'assistant'
  text: string
  citations: Citation[]
}>

// Citation
interface Citation {
  id: string        // 'R1', 'P1', 'A1'
  type: 'R' | 'P' | 'A'
  scope: 'org' | 'dept' | 'project' | 'personal'
  source: string
  title: string
  status?: 'applied' | 'done' | 'pending' | 'resolved'
}

// Settings
tab: 'workspace' | 'personal'
section: 'pod' | 'members' | 'budgets' | 'skills' | 'channels' | 'datanet' | 'apikeys'
       | 'account' | 'awareness' | 'mybudget' | 'mykeys'
subPage: null | 'edit-dept' | 'edit-team' | 'edit-project' | 'marketplace'
       | 'configure-channel' | 'add-channel' | 'add-provider-key'
subPageItem: Department | Team | Project | Channel | null
selectedProvider: string | null
selectedChannelType: string | null
marketplaceCategory: 'All' | 'Memory' | 'Dev' | 'Productivity' | 'Comms' | 'Research' | 'Data'
memberSubTab: 'people' | 'structure'
autoUpdate: boolean
citationMode: boolean

// Data
members: Member[]
departments: Department[]
teams: Team[]
projects: Project[]
skills: Skill[]
channels: Channel[]
apiKeys: ApiKey[]
```

---

## Design Tokens (CSS variables suggested)

```css
:root {
  /* Surfaces */
  --surface-app: #1a1918;
  --surface-content: #f3f0ea;
  --surface-settings-nav: #ebe8e2;
  --surface-card: #ffffff;
  --surface-row-alt: #f8f5ef;

  /* Borders */
  --border-default: #dedad2;
  --border-subtle: #e8e5de;

  /* Text */
  --text-primary: #1a1918;
  --text-secondary: #6a6660;
  --text-muted: #9a9690;
  --text-faint: #b0ada8;

  /* Accent */
  --accent-red: #c1392b;
  --accent-blue: #2a5c9a;
  --accent-green: #2a7d4f;
  --accent-amber: #9a6b2a;

  /* Typography */
  --font-sans: 'DM Sans', system-ui, sans-serif;
  --font-mono: 'DM Mono', monospace;

  /* Radius */
  --radius-card: 10px;
  --radius-input: 6px;
  --radius-btn: 7px;
  --radius-pill: 12px;
}
```

---

## Assets

- **Fonts**: Google Fonts — [DM Sans](https://fonts.google.com/specimen/DM+Sans) + [DM Mono](https://fonts.google.com/specimen/DM+Mono). Self-host for production.
- **Icons**: Inline SVG only, stroke-based, 1.5px stroke-width, round linecap/linejoin. No icon library needed.
- **Avatars**: Initials in colored circles. Palette: `#2a5c9a`, `#2a7d4f`, `#c1392b`, `#9a6b2a`, `#6a2a9a` (cycled by index).

---

## Files

| File | Description |
|---|---|
| `App.dc.html` | Full interactive prototype — both screens wired together |
| `MessageList.jsx` | Standalone React component for chat message rendering |
| `OpenCrane.html` | Self-contained offline bundle (287KB) |
| `screenshots/01-session.png` | Session view screenshot |

---

## Notes for Implementation

1. **Routing**: The two pages (`/` for session, `/settings`) should use your app's router. Sub-pages within settings can be query params (`?section=members&sub=edit-dept&id=eng`) or nested routes.
2. **Settings form rows**: Extract a `SettingsRow` component taking `label`, `description?`, and `children` — you'll use it ~20 times.
3. **Toggle**: A simple controlled boolean input — no library needed, pure CSS animation.
4. **Citation strips**: A `CitationStrip` component taking the citation object; renders the type/scope/source/status chips.
5. **Billing gate**: The invite button and sub-page edits should be gated on the tenant's `memberLimit` from the API. The design shows the disabled state at capacity.
6. **Contract badge**: The `contract v2.3.1 · org · dept · project · personal` line at the bottom of the chat input reflects the active Awareness Contract. Fetch this from the session context.
7. **Message scroll**: On new message append, scroll `chatContainer` to `scrollHeight`. Don't use `scrollIntoView`.
