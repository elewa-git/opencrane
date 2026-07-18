# Architecture

You don't need this page to use OpenCrane — but if you'd like to see how the pieces
fit together, here's the shape of the system in three pictures.

## The big picture

You run one **control plane**. From it you hand out an isolated assistant to each
person, and you configure the shared platform planes those assistants draw on.

<figure class="oc-diagram">
<svg viewBox="0 0 760 470" role="img" aria-label="OpenCrane system overview" xmlns="http://www.w3.org/2000/svg">
<defs><marker id="oc-ah" markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto"><path d="M0,0 L7,3 L0,6 Z" fill="#8a94a6"/></marker></defs>
<rect class="oc-cp" x="270" y="20" width="340" height="66" rx="12"/>
<text x="440" y="48" text-anchor="middle" style="font:700 17px ui-sans-serif,system-ui;fill:#fff">Control plane</text>
<text x="440" y="69" text-anchor="middle" style="font:400 12px ui-sans-serif,system-ui;fill:#e7fbff">OpenCrane UI · REST API · OpenAPI clients</text>
<path class="oc-arr" d="M440,86 V148"/>
<text class="oc-al" x="450" y="120">creates &amp; configures</text>
<rect class="oc-op" x="28" y="150" width="92" height="262" rx="12"/>
<text x="74" y="270" text-anchor="middle" style="font:700 13px ui-sans-serif,system-ui;fill:var(--vp-c-text-1)">Operator</text>
<text x="74" y="289" text-anchor="middle" class="oc-s">reconciles</text>
<text x="74" y="305" text-anchor="middle" class="oc-s">&amp; repairs</text>
<path class="oc-arr" d="M120,200 H146"/>
<path class="oc-arr" d="M120,356 H146"/>
<rect class="oc-grp" x="150" y="150" width="584" height="104" rx="12"/>
<text class="oc-h" x="168" y="174">EMPLOYEE ASSISTANTS · one isolated OpenClaw per person</text>
<rect class="oc-box" x="168" y="188" width="168" height="50" rx="9"/>
<text x="252" y="218" text-anchor="middle" class="oc-l">Alice</text>
<rect class="oc-box" x="358" y="188" width="168" height="50" rx="9"/>
<text x="442" y="218" text-anchor="middle" class="oc-l">Bob</text>
<rect class="oc-box" x="548" y="188" width="168" height="50" rx="9"/>
<text x="632" y="218" text-anchor="middle" class="oc-l">Carla</text>
<path class="oc-arr" d="M440,254 V298"/>
<text class="oc-al" x="450" y="282">reach via short-lived, scoped tokens</text>
<rect class="oc-grp" x="150" y="300" width="584" height="104" rx="12"/>
<text class="oc-h" x="168" y="324">PLATFORM PLANES · configured by the control plane</text>
<rect class="oc-box" x="168" y="338" width="168" height="50" rx="9"/>
<text x="252" y="368" text-anchor="middle" class="oc-l">Tools (MCP)</text>
<rect class="oc-box" x="358" y="338" width="168" height="50" rx="9"/>
<text x="442" y="368" text-anchor="middle" class="oc-l">Skills</text>
<rect class="oc-box" x="548" y="338" width="168" height="50" rx="9"/>
<text x="632" y="368" text-anchor="middle" class="oc-l">Knowledge</text>
<text x="440" y="440" text-anchor="middle" class="oc-s">Everything is API-first — the OpenCrane UI and custom integrations are peers.</text>
</svg>
</figure>

## One login, then a private connection

A person **signs in once**. From then on, the control plane's **identity-routing
proxy** connects them to their own assistant: it checks the session and forwards the
connection to that person's pod. There's no second login, no link to copy, and nothing
for the browser to hold — revoke the session and the next connection stops.

<figure class="oc-diagram">
<svg viewBox="0 0 760 250" role="img" aria-label="Sign-in and connection flow" xmlns="http://www.w3.org/2000/svg">
<defs><marker id="f-ah" markerWidth="10" markerHeight="10" refX="7" refY="3" orient="auto"><path d="M0,0 L8,3 L0,6 Z" fill="#14a8c4"/></marker></defs>
<rect class="f-box" x="28" y="78" width="186" height="92" rx="12"/>
<text x="121" y="118" text-anchor="middle" class="f-l">Your browser</text>
<text x="121" y="140" text-anchor="middle" class="f-s">sign in once (OIDC)</text>
<rect class="f-cp" x="287" y="78" width="186" height="92" rx="12"/>
<text x="380" y="114" text-anchor="middle" style="font:700 15px ui-sans-serif,system-ui;fill:#fff">Control plane</text>
<text x="380" y="136" text-anchor="middle" style="font:400 11.5px ui-sans-serif,system-ui;fill:#e7fbff">identity-routing proxy</text>
<rect class="f-box" x="546" y="78" width="186" height="92" rx="12"/>
<text x="639" y="118" text-anchor="middle" class="f-l">Your assistant</text>
<text x="639" y="140" text-anchor="middle" class="f-s">OpenClaw</text>
<path class="f-arr" d="M214,112 H285"/>
<text x="249" y="100" text-anchor="middle" class="f-al">1. sign in</text>
<path class="f-arr" d="M473,124 H544"/>
<text x="509" y="112" text-anchor="middle" class="f-al">2. routed in</text>
<text x="380" y="210" text-anchor="middle" class="f-s">You hold only a session cookie. The proxy checks it and forwards you to your own pod —</text>
<text x="380" y="230" text-anchor="middle" class="f-s">no pairing link, no token in the browser, no second login.</text>
</svg>
</figure>

## Access is deny-by-default

A new assistant can chat, but it can't reach any skill, tool, or knowledge until you
**grant** it — per person, team, or department.

<figure class="oc-diagram">
<svg viewBox="0 0 760 300" role="img" aria-label="Deny-by-default access model" xmlns="http://www.w3.org/2000/svg">
<defs><marker id="g-ah" markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto"><path d="M0,0 L7,3 L0,6 Z" fill="#8a94a6"/></marker></defs>
<rect class="g-as" x="36" y="108" width="190" height="84" rx="12"/>
<text x="131" y="146" text-anchor="middle" style="font:700 15px ui-sans-serif,system-ui;fill:#fff">An assistant</text>
<text x="131" y="167" text-anchor="middle" style="font:400 11.5px ui-sans-serif,system-ui;fill:#e7fbff">locked down by default</text>
<rect class="g-box" x="556" y="26" width="176" height="56" rx="10"/>
<text x="644" y="59" text-anchor="middle" class="g-l">Skills</text>
<rect class="g-box" x="556" y="122" width="176" height="56" rx="10"/>
<text x="644" y="155" text-anchor="middle" class="g-l">Tools (MCP)</text>
<rect class="g-box" x="556" y="218" width="176" height="56" rx="10"/>
<text x="644" y="251" text-anchor="middle" class="g-l">Knowledge</text>
<path class="g-arr" d="M226,150 L552,54"/>
<path class="g-arr" d="M226,150 L552,150"/>
<path class="g-arr" d="M226,150 L552,246"/>
<rect class="g-pill" x="343" y="88" width="92" height="28" rx="14"/>
<text x="389" y="106" text-anchor="middle" class="g-pt">✓ grant</text>
<rect class="g-pill" x="343" y="136" width="92" height="28" rx="14"/>
<text x="389" y="154" text-anchor="middle" class="g-pt">✓ grant</text>
<rect class="g-pill" x="343" y="184" width="92" height="28" rx="14"/>
<text x="389" y="202" text-anchor="middle" class="g-pt">✓ grant</text>
<text x="380" y="294" text-anchor="middle" class="g-s">You open access deliberately, scoped to exactly what each person needs.</text>
</svg>
</figure>

→ Learn how in [Control access](/guide/permissions), [Share skills](/guide/skills),
[Manage tools](/guide/tools), and [Organizational knowledge](/guide/knowledge).

## Built identity-first

Every arrow between these pieces is an **authenticated, scoped, short-lived
credential exchange** — never a shared secret. People sign in with OIDC; assistants
use audience-bound tokens that expire in minutes; a tool's real credentials are
injected server-side and never reach an assistant or a browser. That's what makes
**instant, per-person revocation** possible.

## Isolation

Each assistant is walled off from every other — separate storage, separate identity,
and **default-deny networking keyed on cryptographic identity** (Cilium + SPIFFE), so
one customer's silo can never reach another's. See
[Identity & network isolation](/operators/cilium-spiffe-identity) for the who-can-talk-to-whom
rules. If you ever need to run **completely separate OpenCrane instances** in one
cluster (say, several customers side by side), see
[Running multiple instances](/advanced/multi-instance) — most deployments never need it.
