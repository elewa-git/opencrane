import { ScopeLevel } from "./scope.types";

/** Settings navigation sections. */
export enum SettingsSection
{
	/** Pod & session settings. */
	Pod = "pod",
	/** Model routing & budget settings. */
	Model = "model",
	/** Awareness contract settings. */
	Awareness = "awareness",
	/** Harvest channel connectors. */
	Channels = "channels",
	/** Access & dataset memberships. */
	Access = "access",
	/** Network & egress allowlist. */
	Network = "network",
	/** Account & identity. */
	Account = "account"
}

/** A settings nav item. */
export interface SettingsNavItem
{
	/** Section id. */
	id: SettingsSection;
	/** Nav label. */
	label: string;
	/** PrimeIcons class. */
	icon: string;
	/** Optional badge (e.g. budget percentage). */
	badge?: string;
}

/** An available LLM with pricing. */
export interface ModelInfo
{
	/** Stable model id. */
	id: string;
	/** Provider name. */
	provider: string;
	/** Display label. */
	label: string;
	/** USD per 1M input tokens (0 = local). */
	inputPer1M: number;
	/** USD per 1M output tokens (0 = local). */
	outputPer1M: number;
}

/** A routed model class with primary + fallbacks. */
export interface ModelClass
{
	/** Stable class id. */
	id: string;
	/** Class label. */
	label: string;
	/** Class accent colour. */
	color: string;
	/** What the class is used for. */
	description: string;
	/** Configuration guidance. */
	hint: string;
	/** Primary model id. */
	primary: string;
	/** Ordered fallback model ids. */
	fallbacks: string[];
	/** Whether the class is enabled. */
	enabled: boolean;
}

/** A spend slice in the monthly budget breakdown. */
export interface SpendSlice
{
	/** Slice label. */
	label: string;
	/** Percentage of monthly spend. */
	pct: number;
	/** Slice colour. */
	color: string;
}

/** A Cognee search mode definition. */
export interface SearchModeInfo
{
	/** Mode key. */
	label: string;
	/** What the mode does. */
	hint: string;
}

/** A Cognee scope dataset in the awareness contract settings. */
export interface CogneeDataset
{
	/** Stable dataset row id. */
	id: string;
	/** Scope level. */
	scope: ScopeLevel;
	/** Dataset display name. */
	name: string;
	/** Cognee dataset id. */
	datasetId: string;
	/** Whether the dataset is queried. */
	enabled: boolean;
	/** Extracted entity count. */
	entities: number;
	/** Chunk count. */
	chunks: number;
	/** Summary count. */
	summaries: number;
	/** Relationship count. */
	relationships: number;
	/** Last cognify run (relative). */
	lastCognify: string;
	/** Last cognify duration. */
	cognifyDuration: string;
	/** Cognify status ("completed" | "running" | "failed"). */
	cognifyStatus: string;
	/** Active search mode keys. */
	searchModes: string[];
	/** Freshness TTL in minutes. */
	freshnessMinutes: number;
	/** Citation coverage percentage. */
	citationCoverage: number;
	/** Connected source labels. */
	sources: string[];
}

/** A harvest channel connector row. */
export interface HarvestChannel
{
	/** Stable channel id. */
	id: string;
	/** Connector name. */
	name: string;
	/** Single-letter icon glyph. */
	icon: string;
	/** Scope level. */
	scope: ScopeLevel;
	/** Target dataset label. */
	dataset: string;
	/** Sync status ("healthy" | "syncing" | "error"). */
	status: string;
	/** Last sync (relative). */
	lastSync: string;
	/** Indexed entry count. */
	entries: number;
}

/** A dataset access membership row. */
export interface DatasetAccess
{
	/** Dataset label. */
	name: string;
	/** Scope level. */
	scope: ScopeLevel;
	/** Access mode ("read" | "read-write"). */
	access: string;
	/** Entry count. */
	entries: number;
	/** When access was granted. */
	granted: string;
}

/** An egress allowlist row. */
export interface EgressDomain
{
	/** Allowed domain. */
	domain: string;
	/** Why it is allowed. */
	purpose: string;
	/** Allowlist status. */
	status: string;
}
