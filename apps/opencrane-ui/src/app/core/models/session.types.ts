/** Message author rendered by the Session stream. */
export enum UiMessageRole
{
	/** Current signed-in user. */
	User = "user",
	/** Assistant response. */
	Assistant = "assistant",
	/** Tool execution. */
	Tool = "tool"
}

/** Lifecycle state rendered for a Session message. */
export enum UiMessageStatus
{
	/** Message is complete. */
	Complete = "complete",
	/** Assistant or tool output is streaming. */
	Streaming = "streaming",
	/** Operation was cancelled. */
	Cancelled = "cancelled",
	/** Operation failed and may be retried. */
	Failed = "failed"
}

/** Scope displayed by a citation strip. */
export enum UiCitationScope
{
	/** Organization-wide source. */
	Organization = "organization",
	/** Department source. */
	Department = "department",
	/** Project source. */
	Project = "project",
	/** Personal source. */
	Personal = "personal"
}

/** Citation attached to an assistant message. */
export interface UiCitation
{
	/** Stable citation identifier. */
	id: string;
	/** Short citation type marker. */
	type: string;
	/** Human-readable source title. */
	title: string;
	/** Scope represented by the citation. */
	scope: UiCitationScope;
	/** Source label displayed in monospace metadata. */
	source: string;
	/** Optional lifecycle label such as applied or resolved. */
	status?: string;
}

/** Session row displayed by the application sidebar. */
export interface UiSessionSummary
{
	/** Stable session route identifier. */
	id: string;
	/** Session title displayed in the sidebar and header. */
	title: string;
	/** Department or scope label. */
	scope: string;
	/** Whether the current identity owns the session. */
	owned: boolean;
	/** Optional unread message count. */
	unread?: number;
	/** Whether activity is currently in progress. */
	active: boolean;
}

/** Message rendered in the Session stream. */
export interface UiMessage
{
	/** Stable message identifier. */
	id: string;
	/** Message author role. */
	role: UiMessageRole;
	/** Markdown-capable message content. */
	content: string;
	/** Message lifecycle status. */
	status: UiMessageStatus;
	/** Citations rendered below assistant content. */
	citations: readonly UiCitation[];
	/** Tool label when the role is Tool. */
	toolName?: string;
}

/** Complete Session state exposed by the selected data provider. */
export interface UiSessionState
{
	/** Sessions displayed by the sidebar. */
	sessions: readonly UiSessionSummary[];
	/** Selected session identifier, or null for a new session. */
	selectedSessionId: string | null;
	/** Messages displayed for the selected session. */
	messages: readonly UiMessage[];
	/** Active model label displayed by the header. */
	model: string;
	/** Awareness contract summary displayed below the composer. */
	contractSummary: string;
	/** Whether the selected transport is connected. */
	connected: boolean;
}
