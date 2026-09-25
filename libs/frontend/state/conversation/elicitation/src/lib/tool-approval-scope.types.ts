import { InjectionToken, type Signal } from "@angular/core";

import type { ListMyToolApprovalScopesResponse, RevokeMyToolApprovalScopeResponse, ToolApprovalScopeSummary } from "@opencrane/contracts";

/** Browser read states for the current requester's standing approvals. */
export enum ToolApprovalScopeReadStates
{
	/** No verified current identity may see retained rows. */
	Inactive = "inactive",
	/** The first current-identity page is being read. */
	Loading = "loading",
	/** The current loaded pages are authoritative. */
	Ready = "ready",
	/** More rows are being read while current rows remain visible. */
	LoadingMore = "loading_more",
	/** The current identity's list could not be read. */
	Unavailable = "unavailable",
}

/** Narrow requester-owned API port; the server derives every identity and permission check. */
export interface ToolApprovalScopeGateway
{
	/** Read one server-sized page using its opaque continuation coordinate. */
	list(cursor?: string, signal?: AbortSignal): Promise<ListMyToolApprovalScopesResponse>;
	/** Withdraw one current requester's scope with a caller-stable retry key. */
	revoke(scopeId: string, idempotencyKey: string): Promise<RevokeMyToolApprovalScopeResponse>;
}

/** Verified host-session boundary used to partition and purge requester-owned scope state. */
export interface ToolApprovalScopeSession
{
	/** Stable account and tenant generation, or null while identity is unavailable. */
	readonly scope: Signal<string | null>;
	/** Ask the host to revalidate identity after an authorization refusal. */
	revalidate(): void;
}

/** Host-supplied requester identity boundary for standing approval state. */
export const TOOL_APPROVAL_SCOPE_SESSION = new InjectionToken<ToolApprovalScopeSession>("TOOL_APPROVAL_SCOPE_SESSION");

/** Public state used by the routed feature without exposing mutable command internals. */
export interface ToolApprovalScopeState
{
	/** Requester-owned safe summaries from every page loaded so far. */
	readonly scopes: readonly ToolApprovalScopeSummary[];
	/** Current read lifecycle. */
	readonly readState: ToolApprovalScopeReadStates;
	/** Safe read error, when present. */
	readonly error: string | null;
	/** Whether an opaque continuation page remains. */
	readonly hasMore: boolean;
}
