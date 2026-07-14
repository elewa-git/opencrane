# OpenCrane UI semantic contrast pairs

Ratios were calculated from the sRGB values below. Text pairs meet WCAG 2.2 AA for normal text;
focus and status-only pairs meet the 3:1 non-text requirement. Canonical teal, orange, red, blue,
green, and amber values remain unchanged from the handoff. Darker hover teal is a state token, not a
replacement for canonical teal.

| State / use | Foreground | Background | Ratio | Requirement |
|---|---:|---:|---:|---|
| Default body | `#1a1918` | `#f3f0ea` | 15.44:1 | AA text |
| Secondary body | `#6a6660` | `#f3f0ea` | 5.01:1 | AA text |
| Sidebar inactive/meta | `#938f8b` | `#1a1918` | 5.47:1 | AA text |
| Sidebar selected | `#ffffff` | `#2a2826` | 14.69:1 | AA text |
| Teal default CTA | `#1a1918` | `#0db5cc` | 7.10:1 | AA text |
| Teal hover CTA | `#ffffff` | `#08798d` | 5.08:1 | AA text |
| Orange activity/badge | `#1a1918` | `#f47920` | 6.36:1 | AA text |
| Red danger action | `#ffffff` | `#c1392b` | 5.40:1 | AA text |
| Retrieval/administrator tag | `#1a1918` | `#ddeeff` | 14.84:1 | AA text |
| Policy tag | `#1a1918` | `#fef0d0` | 15.54:1 | AA text |
| Action/member tag | `#1a1918` | `#d8f0e4` | 14.63:1 | AA text |
| Disabled toggle/control | `#1a1918` | `#cec9c3` | 10.67:1 | AA text |
| Blue avatar | `#ffffff` | `#2a5c9a` | 6.78:1 | AA text |
| Green success | `#ffffff` | `#2a7d4f` | 5.07:1 | AA text |
| Connected status | `#1a1918` | `#22c55e` | 7.70:1 | AA text |
| Focus indicator | `#08798d` | `#ffffff` | 5.08:1 | 3:1 non-text |

The handoff's original sidebar-muted values (`#7a7673`, `#4a4845`, and `#3a3835`) do not meet
normal-text AA on `#1a1918`. The implementation therefore uses `#938f8b` for inactive, metadata,
and section-label text while retaining the original hierarchy through font size and weight.
