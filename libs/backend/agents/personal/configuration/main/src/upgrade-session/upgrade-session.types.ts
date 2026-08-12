import type { RunInputSnapshot } from "@opencrane/contracts";
import type { JsonValue } from "@opencrane/util";

import type { PersonalConfigurationPatch } from "../proposal/personal-configuration-patch.types.js";

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

/** Personal conversation snapshot admitted before upgrade-session persistence begins. */
export interface PersonalUpgradeSessionSnapshot extends RunInputSnapshot
{
	/** Conversation that supplied the future-session request. */
	readonly conversationId: string;
	/** Personal revision observed by the immutable run. */
	readonly personaRevisionId: string;
}

/** Runtime candidate whose protected arguments match the closed configuration-patch model. */
export interface PersonalUpgradeSessionCandidate extends UpgradeSessionInvocation
{
	/** Strict personal configuration patch admitted by the model-adjacent Zod validator. */
	readonly arguments: PersonalConfigurationPatch;
}

/** Immutable owner coordinates used to resolve the canonical personal profile. */
export interface UpgradeSessionProfileReadCommand
{
	/** Silo copied from the frozen run snapshot. */
	readonly siloId: string;
	/** Execution subject copied from the frozen identity snapshot. */
	readonly userId: string;
}

/** Transaction-scoped owner-profile reader for one upgrade-session proposal. */
export interface UpgradeSessionProfileRepository
{
	/** Resolves the unique profile owned by the frozen silo and execution subject. */
	readOwnerProfileId(command: UpgradeSessionProfileReadCommand): Promise<string | null>;
}
