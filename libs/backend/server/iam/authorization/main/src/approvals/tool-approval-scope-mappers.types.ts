import type { ToolApprovalScopeStates } from "@opencrane/contracts";

/** Saved metadata needed to disclose one standing approval without its reviewed arguments. */
export interface ToolApprovalScopeSummarySource
{
	/** Scope identity. */
	readonly id: string;
	/** Public active or revoked lifecycle state. */
	readonly state: ToolApprovalScopeStates;
	/** Human-readable reviewed action. */
	readonly actionLabel: string;
	/** Human-readable reviewed target. */
	readonly targetLabel: string;
	/** Display-safe external system label when present. */
	readonly externalSystemLabel: string | null;
	/** Display-safe assistant label when present. */
	readonly assistantLabel: string | null;
	/** Display-safe connection owner label. */
	readonly connectionOwnerLabel: string;
	/** Time at which the original requester approved this scope. */
	readonly createdAt: Date;
	/** Time at which the requester revoked this scope. */
	readonly revokedAt: Date | null;
}
