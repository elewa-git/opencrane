import type { RunInputSnapshot, RuntimeExternalActionCandidate } from "@opencrane/contracts";
import type { JsonValue } from "@opencrane/util";

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
	proposeUpgradeSession(candidate: RuntimeExternalActionCandidate, snapshot: RunInputSnapshot, now: string): Promise<UpgradeSessionProposalReceipt>;
}
