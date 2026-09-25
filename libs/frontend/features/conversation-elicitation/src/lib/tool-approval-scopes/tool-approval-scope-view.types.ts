import type { ScopeChipTones } from "@opencrane/elements/ui";
import type { ToolApprovalScopeReadStates } from "@opencrane/state/conversation/elicitation";

/** Safe presentation row for one requester-owned standing approval. */
export interface ToolApprovalScopeRowView
{
	/** Opaque identifier returned unchanged with a revoke intent. */
	readonly id: string;
	/** Display-safe action reviewed on the first approval. */
	readonly action: string;
	/** Display-safe target reviewed on the first approval. */
	readonly target: string;
	/** External system label, when supplied by the server. */
	readonly externalSystem?: string;
	/** Assistant label, when supplied by the server. */
	readonly assistantLabel?: string;
	/** Display-safe owner of the execution connection. */
	readonly connectionOwnerLabel: string;
	/** Localised creation time. */
	readonly createdAtLabel: string;
	/** Localised revocation time, when authoritative state is revoked. */
	readonly revokedAtLabel?: string;
	/** Human-readable lifecycle label. */
	readonly stateLabel: string;
	/** Shared semantic chip tone for the lifecycle. */
	readonly stateTone: ScopeChipTones;
	/** Whether the current authoritative state still offers revocation. */
	readonly canRevoke: boolean;
	/** Whether this row owns an admitted revocation command. */
	readonly busy: boolean;
	/** Safe command failure for this row. */
	readonly error: string | null;
	/** Whether this row was most recently confirmed revoked. */
	readonly revokedNow: boolean;
}

/** Complete display projection for the standing-approval settings screen. */
export interface ToolApprovalScopeViewModel
{
	/** Current list-read lifecycle. */
	readonly readState: ToolApprovalScopeReadStates;
	/** Safe list-level failure. */
	readonly error: string | null;
	/** Mapped safe rows in server order. */
	readonly rows: readonly ToolApprovalScopeRowView[];
	/** Whether the user may request the next opaque page. */
	readonly hasMore: boolean;
}
