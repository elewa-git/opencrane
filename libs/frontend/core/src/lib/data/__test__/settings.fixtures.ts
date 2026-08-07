import { CogneeDataset, DatasetAccess, EgressDomain, HarvestChannel, SpendSlice } from "../../models/settings.types";
import { ScopeLevel } from "../../models/scope.types";

/** Monthly spend breakdown slices. */
export const SPEND_SLICES: SpendSlice[] =
[
	{ label: "Routing", pct: 3, color: "#7A766D" },
	{ label: "Writing", pct: 41, color: "#5A8A7A" },
	{ label: "Reasoning", pct: 28, color: "#7A6AA0" },
	{ label: "High", pct: 22, color: "#C84B31" },
	{ label: "Other", pct: 6, color: "#4A6B8A" }
];

/** Cognee scope datasets in the awareness contract. */
export const COGNEE_DATASETS: CogneeDataset[] =
[
	{ id: "ds-org", scope: ScopeLevel.Org, name: "acme-corp", datasetId: "ds_acme_corp_v3", enabled: true, entities: 18420, chunks: 94300, summaries: 2140, relationships: 61800, lastCognify: "4m ago", cognifyDuration: "8m 14s", cognifyStatus: "completed", searchModes: ["vector", "hybrid", "graph_completion"], freshnessMinutes: 30, citationCoverage: 91, sources: ["Slack (org-wide)", "Confluence", "Google Drive (shared)"] },
	{ id: "ds-dept", scope: ScopeLevel.Dept, name: "Product", datasetId: "ds_product_dept_v2", enabled: true, entities: 3204, chunks: 18900, summaries: 440, relationships: 9800, lastCognify: "12m ago", cognifyDuration: "2m 51s", cognifyStatus: "completed", searchModes: ["vector", "hybrid", "graph_completion", "cypher"], freshnessMinutes: 20, citationCoverage: 88, sources: ["Slack #product-leadership", "Jira (Product board)", "Notion (Product wiki)"] },
	{ id: "ds-project", scope: ScopeLevel.Project, name: "platform-v2", datasetId: "ds_platform_v2", enabled: true, entities: 622, chunks: 4100, summaries: 98, relationships: 1930, lastCognify: "1h ago", cognifyDuration: "48s", cognifyStatus: "completed", searchModes: ["vector", "hybrid"], freshnessMinutes: 60, citationCoverage: 82, sources: ["GitHub (platform-v2 repo)", "Linear (platform-v2 project)"] },
	{ id: "ds-personal", scope: ScopeLevel.Personal, name: "alex.oc", datasetId: "ds_alex_personal", enabled: true, entities: 210, chunks: 880, summaries: 34, relationships: 390, lastCognify: "live", cognifyDuration: "—", cognifyStatus: "completed", searchModes: ["vector"], freshnessMinutes: 5, citationCoverage: 95, sources: ["Pod private storage", "Personal notes"] }
];

/** Harvest channel connectors. */
export const HARVEST_CHANNELS: HarvestChannel[] =
[
	{ id: "ch1", name: "Slack", icon: "S", scope: ScopeLevel.Org, dataset: "acme-corp · org", status: "syncing", lastSync: "4m ago", entries: 14820 },
	{ id: "ch2", name: "Slack #product-leadership", icon: "S", scope: ScopeLevel.Dept, dataset: "Product · dept", status: "healthy", lastSync: "12m ago", entries: 3204 },
	{ id: "ch3", name: "Jira (platform-v2)", icon: "J", scope: ScopeLevel.Project, dataset: "platform-v2 · project", status: "healthy", lastSync: "1h ago", entries: 891 },
	{ id: "ch4", name: "Confluence", icon: "C", scope: ScopeLevel.Org, dataset: "acme-corp · org", status: "healthy", lastSync: "2h ago", entries: 6411 },
	{ id: "ch5", name: "Google Drive (Product)", icon: "G", scope: ScopeLevel.Dept, dataset: "Product · dept", status: "error", lastSync: "6h ago", entries: 1032 }
];

/** Dataset access memberships. */
export const DATASET_ACCESS: DatasetAccess[] =
[
	{ name: "acme-corp · org", scope: ScopeLevel.Org, access: "read", entries: 22463, granted: "Jan 2026" },
	{ name: "Product · dept", scope: ScopeLevel.Dept, access: "read", entries: 4236, granted: "Jan 2026" },
	{ name: "platform-v2 · project", scope: ScopeLevel.Project, access: "read-write", entries: 891, granted: "Mar 2026" },
	{ name: "finance · dept", scope: ScopeLevel.Dept, access: "read", entries: 1820, granted: "Jun 2026" },
	{ name: "alex.oc · personal", scope: ScopeLevel.Personal, access: "read-write", entries: 312, granted: "Jan 2026" }
];

/** Egress allowlist rows. */
export const EGRESS_DOMAINS: EgressDomain[] =
[
	{ domain: "api.anthropic.com", purpose: "LLM inference", status: "active" },
	{ domain: "cognee.acme-corp.internal", purpose: "Knowledge retrieval", status: "active" },
	{ domain: "jira.acme-corp.com", purpose: "Jira MCP tool", status: "active" },
	{ domain: "github.com", purpose: "GitHub MCP tool", status: "active" },
	{ domain: "confluence.acme-corp.com", purpose: "Confluence connector", status: "active" }
];
