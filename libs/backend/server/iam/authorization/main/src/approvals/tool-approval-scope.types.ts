import type { ElicitationExecutionConnection, ToolApprovalScopeSummary } from "@opencrane/contracts";
import type { ExecutionSubject } from "@opencrane/models/agents";
import type { JsonValue } from "@opencrane/util";

/** Durable coordinates that bind standing consent to the exact reviewed execution connection. */
export interface ToolApprovalConnectionBinding
{
	/** Browser-safe ownership disclosure saved with the original approval. */
	readonly disclosure: ElicitationExecutionConnection;
	/** Exact remote connection, or null for an OCI installation. */
	readonly connectionId: string | null;
	/** Principal that owns the installation and any remote connection. */
	readonly connectionOwnerPrincipalId: string;
	/** Exact remote connection generation, or null for an OCI installation. */
	readonly connectionGeneration: number | null;
	/** Exact remote endpoint digest, or null for an OCI installation. */
	readonly connectionEndpointDigest: string | null;
	/** Display-safe assistant label when the reviewed connection belongs to a managed assistant. */
	readonly assistantLabel: string | null;
}

/** Inputs required to create a scope from one authenticated first approval. */
export interface CreateToolApprovalScopeCommand
{
	readonly approvalRequestId: string;
	readonly siloId: string;
	readonly requesterPrincipalId: string;
	readonly requesterSubjectId: string;
	readonly agentServiceId: string;
	readonly agentRevisionId: string;
	readonly toolRevisionId: string;
	readonly arguments: JsonValue;
	readonly argumentsDigest: string;
	readonly actionLabel: string;
	readonly targetLabel: string;
	readonly externalSystemLabel: string | null;
	readonly connection: ToolApprovalConnectionBinding;
	readonly now: Date;
}

/** Inputs used to derive one-use approval evidence for a matching invocation. */
export interface ApplyStandingToolApprovalCommand
{
	readonly invocationId: string;
	readonly siloId: string;
	readonly requesterPrincipalId: string;
	readonly requesterSubjectId: string;
	readonly agentServiceId: string;
	readonly agentRevisionId: string;
	readonly toolRevisionId: string;
	readonly arguments: JsonValue;
	readonly argumentsDigest: string;
	readonly connection: ToolApprovalConnectionBinding;
	readonly now: Date;
}

/** Trusted requester coordinates for the browser-facing scope catalogue. */
export interface ToolApprovalScopeCaller
{
	readonly siloId: string;
	readonly subjectId: string;
}

/** One bounded page of requester-owned standing approvals. */
export interface ToolApprovalScopePage
{
	readonly scopes: readonly ToolApprovalScopeSummary[];
	readonly nextCursor?: string;
}

/** Authoritative outcomes of an idempotent scope revocation. */
export type RevokeToolApprovalScopeResult =
	| { readonly outcome: "revoked"; readonly scope: ToolApprovalScopeSummary; readonly idempotent: boolean }
	| { readonly outcome: "not_found" | "forbidden" | "conflict" };

/** Browser-facing standing approval authority. */
export interface ToolApprovalScopeAuthority
{
	list(caller: ToolApprovalScopeCaller, cursor: string | null, now: Date): Promise<ToolApprovalScopePage>;
	revoke(caller: ToolApprovalScopeCaller, scopeId: string, idempotencyKey: string, now: Date): Promise<RevokeToolApprovalScopeResult>;
}

/** Context resolved while opening a human approval and reused for exact standing-consent matching. */
export interface ToolApprovalOpeningContext
{
	readonly subject: ExecutionSubject;
	readonly requesterPrincipalId: string;
	readonly connection: ToolApprovalConnectionBinding;
}
