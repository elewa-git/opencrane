import { UiAccountSettings, UiAwarenessSettings, UiBudgetSettings, UiChannel, UiDataset, UiMember, UiOrganizationUnit, UiPersonalAccessToken, UiPodSettings, UiProviderCredential, UiSkill } from "../../models/settings.types.js";

/** Creates fresh Pod settings for each mock reset. */
export function _DefaultPodSettings(): UiPodSettings
{
	return { id: "oc-elewa", displayName: "Elewa workspace", version: "2.3.1", storageUsed: "18.4 GB", storageQuota: "100 GB", autoUpdate: true };
}

/** Creates fresh organization members for each mock reset. */
export function _DefaultMembers(): readonly UiMember[]
{
	return [
		{ id: "member-amara", name: "Amara Okafor", email: "amara@example.test", role: "Admin", spend: 124, limit: 150 },
		{ id: "member-jonah", name: "Jonah Kimani", email: "jonah@example.test", role: "Member", spend: 68, limit: 120 },
		{ id: "member-priya", name: "Priya Shah", email: "priya@example.test", role: "Viewer", spend: 32, limit: 100 }
	];
}

/** Creates fresh departments, teams, and projects for each mock reset. */
export function _DefaultOrganizationUnits(): readonly UiOrganizationUnit[]
{
	return [
		{ id: "department-product", name: "Product", kind: "department", memberCount: 8 },
		{ id: "team-platform", name: "Platform", kind: "team", memberCount: 4, parentId: "department-product" },
		{ id: "project-launch", name: "Launch 2026", kind: "project", memberCount: 6, status: "active" }
	];
}

/** Creates a fresh organization budget summary. */
export function _DefaultBudget(): UiBudgetSettings
{
	return { spent: 812, limit: 1200, routingStrategy: "Balanced", resetDate: "1 August 2026" };
}

/** Creates fresh installed and marketplace skill rows. */
export function _DefaultSkills(): readonly UiSkill[]
{
	return [
		{ id: "skill-memory", name: "Organization memory", category: "Memory", version: "2.3.1", installed: true, enabled: true },
		{ id: "skill-research", name: "Deep research", category: "Research", version: "1.8.0", installed: true, enabled: false },
		{ id: "skill-brief", name: "Executive brief", category: "Productivity", version: "1.2.4", installed: false, enabled: false }
	];
}

/** Creates fresh channel rows. */
export function _DefaultChannels(): readonly UiChannel[]
{
	return [
		{ id: "channel-slack", name: "Slack", handle: "#opencrane", status: "connected" },
		{ id: "channel-teams", name: "Microsoft Teams", handle: "Launch room", status: "disconnected" }
	];
}

/** Creates fresh dataset rows. */
export function _DefaultDatasets(): readonly UiDataset[]
{
	return [
		{ id: "dataset-product", name: "Product knowledge", scope: "project", nodeCount: 12840, active: true },
		{ id: "dataset-company", name: "Company handbook", scope: "organization", nodeCount: 4210, active: true }
	];
}

/** Creates fresh safe provider credential metadata. */
export function _DefaultProviderCredentials(): readonly UiProviderCredential[]
{
	return [
		{ id: "credential-anthropic", provider: "Anthropic", fingerprint: "sk-ant-••••-7F2A", models: ["Claude Sonnet", "Claude Haiku"], connected: true }
	];
}

/** Creates fresh Personal Account settings. */
export function _DefaultAccountSettings(): UiAccountSettings
{
	return { displayName: "Amara Okafor", email: "amara@example.test", role: "Administrator", notifications: true };
}

/** Creates fresh Personal Awareness settings. */
export function _DefaultAwarenessSettings(): UiAwarenessSettings
{
	return { fallback: "Ask before broadening scope", citationMode: true, scopeOrder: ["personal", "project", "dept", "org"] };
}

/** Creates fresh safe personal access-token metadata. */
export function _DefaultPersonalTokens(): readonly UiPersonalAccessToken[]
{
	return [];
}
