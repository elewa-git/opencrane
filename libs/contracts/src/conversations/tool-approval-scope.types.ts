/** Lifecycle of requester-owned standing consent for matching tool writes. */
export enum ToolApprovalScopeStates
{
	/** Matching future effects may create one-use admissions after all current checks pass. */
	Active = "active",
	/** Future admissions are closed; earlier claimed effects remain historical evidence. */
	Revoked = "revoked",
}

/** Browser-safe summary of one requester-owned standing tool approval. */
export interface ToolApprovalScopeSummary
{
	/** Opaque scope identifier used for revocation. */
	readonly id: string;
	/** Current lifecycle state. */
	readonly state: ToolApprovalScopeStates;
	/** Display-safe action copied from the first reviewed approval. */
	readonly action: string;
	/** Display-safe tool target copied from the first reviewed approval. */
	readonly target: string;
	/** Display-safe external system name when the approval disclosed one. */
	readonly externalSystem?: string;
	/** Display-safe assistant label when the server could resolve one. */
	readonly assistantLabel?: string;
	/** Display-safe owner of the connection used by matching effects. */
	readonly connectionOwnerLabel: string;
	/** ISO-8601 creation time. */
	readonly createdAt: string;
	/** ISO-8601 revocation time after consent is withdrawn. */
	readonly revokedAt?: string;
}

/** Response returned by the requester-owned standing approval list. */
export interface ListMyToolApprovalScopesResponse
{
	/** Up to one hundred readable scopes in newest-first order. */
	readonly scopes: readonly ToolApprovalScopeSummary[];
	/** Opaque continuation coordinate when older readable scopes may remain. */
	readonly nextCursor?: string;
}

/** Idempotent command that withdraws one standing approval. */
export interface RevokeMyToolApprovalScopeCommand
{
	/** Caller-stable key that makes an uncertain browser retry safe. */
	readonly idempotencyKey: string;
}

/** Authoritative state returned after standing approval revocation. */
export interface RevokeMyToolApprovalScopeResponse
{
	/** Current saved scope after the command. */
	readonly scope: ToolApprovalScopeSummary;
	/** Whether this call replayed the same saved revocation command. */
	readonly idempotent: boolean;
}
