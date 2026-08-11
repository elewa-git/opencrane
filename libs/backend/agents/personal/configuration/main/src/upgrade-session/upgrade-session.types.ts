import type { RunInputSnapshot } from "@opencrane/contracts";
import type { JsonValue } from "@opencrane/util";

/** Durable built-in action fields accepted after runtime candidate admission. */
export interface UpgradeSessionInvocation
{
	/** Run that owns the requested future configuration change. */
	readonly runId: string;
	/** Attempt that admitted the action. */
	readonly attempt: number;
	/** Immutable built-in tool revision. */
	readonly toolRevisionId: string;
	/** Invocation coordinate retained for audit correlation. */
	readonly toolInvocationId: string;
	/** Digest of the canonical proposed patch. */
	readonly argumentsDigest: string;
	/** Canonical validated proposed patch. */
	readonly arguments: JsonValue;
}

/** Result returned to the ToolInvocation ledger for one accepted upgrade-session request. */
export interface UpgradeSessionProposalReceipt
{
	/** Allows the durable receipt to remain a valid tool-result JSON object. */
	readonly [key: string]: JsonValue;
	/** Durable change identifier whose later decision can affect only a future snapshot. */
	readonly changeId: string;
}

/** Persistence boundary that maps a first-party tool candidate into a configuration proposal. */
export interface UpgradeSessionProposalRepository
{
	/** Resolves the canonical profile for the snapshot's personal subject. */
	proposeUpgradeSession(candidate: UpgradeSessionInvocation, snapshot: RunInputSnapshot, now: string): Promise<UpgradeSessionProposalReceipt>;
}

/** Process-scoped transaction owner for one durable upgrade-session proposal. */
export interface UpgradeSessionProposalUnitOfWork extends UpgradeSessionProposalRepository {}
