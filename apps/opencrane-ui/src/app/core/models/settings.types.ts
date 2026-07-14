/** Pod settings displayed by Workspace Settings. */
export interface UiPodSettings
{
	/** Stable pod identifier. */
	id: string;
	/** Editable display name. */
	displayName: string;
	/** Displayed OpenCrane version. */
	version: string;
	/** Human-readable storage usage. */
	storageUsed: string;
	/** Human-readable storage quota. */
	storageQuota: string;
	/** Whether automatic updates are enabled. */
	autoUpdate: boolean;
}

/** Organization member displayed by People and budget tables. */
export interface UiMember
{
	/** Stable member identifier. */
	id: string;
	/** Display name. */
	name: string;
	/** Mock email address. */
	email: string;
	/** Displayed role label. */
	role: string;
	/** Monthly spend. */
	spend: number;
	/** Monthly budget limit. */
	limit: number;
}

/** Organization unit used by department, team, and project routes. */
export interface UiOrganizationUnit
{
	/** Stable route identifier. */
	id: string;
	/** Display name. */
	name: string;
	/** Unit kind. */
	kind: "department" | "team" | "project";
	/** Related member count. */
	memberCount: number;
	/** Optional parent department identifier. */
	parentId?: string;
	/** Optional project lifecycle label. */
	status?: "active" | "draft" | "archived";
}

/** Organization budget summary. */
export interface UiBudgetSettings
{
	/** Current organization spend. */
	spent: number;
	/** Organization allocation. */
	limit: number;
	/** Displayed routing strategy. */
	routingStrategy: string;
	/** Stable reset-date label. */
	resetDate: string;
}

/** Skill displayed by installed and marketplace views. */
export interface UiSkill
{
	/** Stable skill identifier. */
	id: string;
	/** Skill name. */
	name: string;
	/** Marketplace category. */
	category: string;
	/** Semantic version label. */
	version: string;
	/** Whether the skill is installed. */
	installed: boolean;
	/** Whether an installed skill is enabled. */
	enabled: boolean;
}

/** Channel displayed by Workspace Settings. */
export interface UiChannel
{
	/** Stable channel route identifier. */
	id: string;
	/** Provider display name. */
	name: string;
	/** Mock account handle. */
	handle: string;
	/** Connection status label. */
	status: "connected" | "disconnected" | "connecting" | "failed";
}

/** Dataset displayed by Data and Network settings. */
export interface UiDataset
{
	/** Stable dataset identifier. */
	id: string;
	/** Dataset name. */
	name: string;
	/** Scope metadata. */
	scope: string;
	/** Mock node count. */
	nodeCount: number;
	/** Whether the dataset is active. */
	active: boolean;
}

/** Safe provider credential status; never contains secret material. */
export interface UiProviderCredential
{
	/** Stable provider identifier. */
	id: string;
	/** Provider display name. */
	provider: string;
	/** Safe seeded fingerprint. */
	fingerprint: string;
	/** Supported model labels. */
	models: readonly string[];
	/** Whether a provider credential is connected. */
	connected: boolean;
}

/** Personal account fields displayed by Settings. */
export interface UiAccountSettings
{
	/** Editable display name. */
	displayName: string;
	/** Read-only account email. */
	email: string;
	/** Displayed role label. */
	role: string;
	/** Whether product notifications are enabled. */
	notifications: boolean;
}

/** Awareness preferences displayed by Personal Settings. */
export interface UiAwarenessSettings
{
	/** Selected fallback behavior. */
	fallback: string;
	/** Whether citation mode is enabled. */
	citationMode: boolean;
	/** Ordered scope summary. */
	scopeOrder: readonly string[];
}

/** Safe personal access-token metadata. */
export interface UiPersonalAccessToken
{
	/** Stable token identifier. */
	id: string;
	/** User-selected token label. */
	name: string;
	/** Seeded creation date label. */
	createdAt: string;
	/** Safe token prefix displayed after creation. */
	prefix: string;
}
