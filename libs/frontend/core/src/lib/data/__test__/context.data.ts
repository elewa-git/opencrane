import { ActiveSkill, CanvasInitiative, CanvasInitiativeStates, CanvasMetric, CanvasRisk, CanvasRiskSeverities, LedgerEntry, ScopeCitation, ScopeContextEntry } from "../../models/context.types";
import { ResourceBoundaryKind } from "../../models/boundary.types";

/** Scope datasets feeding the current session, innermost first. */
export const SCOPE_CONTEXT: ScopeContextEntry[] =
[
	{ boundaryId: "group-acme", boundaryKind: ResourceBoundaryKind.Group, label: "acme-corp", sublabel: "Company group knowledge", active: true, freshness: "4m ago", citationCount: 3, color: "#5A8A5A" },
	{ boundaryId: "group-product", boundaryKind: ResourceBoundaryKind.Group, label: "Product", sublabel: "Child group dataset", active: true, freshness: "12m ago", citationCount: 5, color: "#7A6AA0" },
	{ boundaryId: "group-platform-v2", boundaryKind: ResourceBoundaryKind.Group, label: "platform-v2", sublabel: "Child group context", active: true, freshness: "1h ago", citationCount: 2, color: "#4A6B8A" },
	{ boundaryId: "principal-alex", boundaryKind: ResourceBoundaryKind.Personal, label: "alex.oc", sublabel: "Personal boundary storage", active: true, freshness: "live", citationCount: 1, color: "#C84B31" }
];

/** Citations retrieved for the current thread, grouped by scope. */
export const SCOPE_CITATIONS: ScopeCitation[] =
[
	{ id: "c1", boundaryId: "group-product", boundaryKind: ResourceBoundaryKind.Group, source: "product-strategy-q3.md", snippet: "PLG expansion is the highest-priority initiative for Q3, approved at Product all-hands 2026-05-14.", freshness: "12m ago" },
	{ id: "c2", boundaryId: "group-product", boundaryKind: ResourceBoundaryKind.Group, source: "slack:#product-leadership", snippet: "VP sign-off required for any resourcing decisions above $50K. Confirmed in company policy v2.1.", freshness: "4m ago" },
	{ id: "c3", boundaryId: "group-platform-v2", boundaryKind: ResourceBoundaryKind.Group, source: "platform-v2/roadmap.md", snippet: "Data export v1 is the blocker for enterprise accounts currently stalled at procurement.", freshness: "1h ago" },
	{ id: "c4", boundaryId: "group-product", boundaryKind: ResourceBoundaryKind.Group, source: "teams:#product-team", snippet: "Q3 ARR target is $4.2M — confirmed with Finance in the May 30 review.", freshness: "12m ago" },
	{ id: "c5", boundaryId: "group-acme", boundaryKind: ResourceBoundaryKind.Group, source: "confluence:company-policies", snippet: "Budget decisions require dual approval from the accountable group lead and Finance lead.", freshness: "4m ago" }
];

/** Skills active in the current session. */
export const ACTIVE_SKILLS: ActiveSkill[] =
[
	{ name: "document-writer", boundaryKind: ResourceBoundaryKind.Group, version: "1.4.2", active: true },
	{ name: "strategy-analyst", boundaryKind: ResourceBoundaryKind.Group, version: "0.9.1", active: true },
	{ name: "jira-sync", boundaryKind: ResourceBoundaryKind.Group, version: "2.0.0", active: true },
	{ name: "personal-notes", boundaryKind: ResourceBoundaryKind.Personal, version: "local", active: true }
];

/** Ledger trace entries for the current session. */
export const LEDGER_ENTRIES: LedgerEntry[] =
[
	{ id: "R1", type: "observation", boundaryKind: ResourceBoundaryKind.Group, label: "DV360 already under-pacing", ref: "dv360_status", status: null },
	{ id: "R2", type: "observation", boundaryKind: ResourceBoundaryKind.Group, label: "Approved plan is national awareness-led", ref: "plan.primary_kpi", status: null },
	{ id: "R3", type: "observation", boundaryKind: ResourceBoundaryKind.Group, label: "Manchester store selling ahead of average", ref: "manchester_sales", status: "resolved" },
	{ id: "P1", type: "policy", boundaryKind: ResourceBoundaryKind.Group, label: "Spend changes require human approval", ref: "company_policy.v2.1", status: "applied" },
	{ id: "A1", type: "action", boundaryKind: ResourceBoundaryKind.Personal, label: "Prepared recommendation note", ref: "boots-decision-note.md", status: "pending" }
];

/** Canvas doc — growth target metric rows. */
export const CANVAS_METRICS: CanvasMetric[] =
[
	{ label: "ARR target", value: "$4.2M", note: "+18% QoQ" },
	{ label: "New logos", value: "22", note: "net new accounts" },
	{ label: "NRR", value: "≥110%", note: "net revenue retention" },
	{ label: "Trial → paid", value: "+40%", note: "vs Q2 baseline" }
];

/** Canvas doc — key initiative table rows. */
export const CANVAS_INITIATIVES: CanvasInitiative[] =
[
	{ name: "PLG expansion", owner: "Growth", target: "+40% trial starts", timeline: "Jul 1 – Aug 15", status: CanvasInitiativeStates.OnTrack },
	{ name: "Enterprise pilot", owner: "Sales", target: "3 design partners", timeline: "Jul 15 – Sep 30", status: CanvasInitiativeStates.AtRisk },
	{ name: "Data export v1", owner: "Engineering", target: "GA release", timeline: "Aug 30", status: CanvasInitiativeStates.OnTrack },
	{ name: "Mobile beta", owner: "Product", target: "500 beta users", timeline: "Sep 15", status: CanvasInitiativeStates.Pending }
];

/** Canvas doc — top risk rows. */
export const CANVAS_RISKS: CanvasRisk[] =
[
	{ risk: "PLG conversion underperforms if onboarding rework slips past Aug 1", severity: CanvasRiskSeverities.High },
	{ risk: "Enterprise pilot stalls if Data Export v1 misses Aug 30 deadline", severity: CanvasRiskSeverities.High },
	{ risk: "Mobile beta scope creep delays Q4 GA by a sprint or more", severity: CanvasRiskSeverities.Medium }
];
