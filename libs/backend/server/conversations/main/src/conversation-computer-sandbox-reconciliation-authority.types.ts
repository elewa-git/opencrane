import type { AgentSandboxClaimObservationReader, AgentSandboxRuntimePodReader } from "@opencrane/backend/server/infra/agent-sandbox-claims";

import type { ConversationComputerActivationClock, ConversationComputerActivationProfileResolver } from "./conversation-computer-activation-authority.types";
import type { ConversationComputerHistory } from "./conversation-computers";

/**
 * States the transient result of one exact Agent Sandbox status reconciliation pass.
 *
 * The worker uses this closed set to decide whether an in-memory polling locator stays in its next
 * pass. These values are never persisted: `Warmed` reports an appended warm lease,
 * `ExecutionPending` reports a current warm lease, and `Compensated` reports an appended recovery.
 * The other outcomes append nothing. An unknown result must not keep polling a claim.
 */
export enum ConversationComputerSandboxReconciliationOutcomes
{
	/** The claim has not published a current ready assignment, so the worker must retain the locator. */
	Pending = "pending",
	/** This pass appended Warm and an active lease from one current controller assignment, so execution admission runs. */
	Warmed = "warmed",
	/** The exact generation already has an unexpired warm lease, so the worker must recover execution admission. */
	ExecutionPending = "execution-pending",
	/** This pass appended RecoveryRequired and a lost lease after the dispatch expired, so polling stops. */
	Compensated = "compensated",
	/** Current history no longer names this generation as pending or dispatched, so polling stops. */
	Ignored = "ignored",
	/** Release admission or immutable claim evidence prevents observation, so the worker logs and drops it. */
	Blocked = "blocked",
}

/** Names the transient result returned from one reconciliation pass to its worker. */
export type ConversationComputerSandboxReconciliationOutcome = ConversationComputerSandboxReconciliationOutcomes;

/**
 * Supplies the checked ports that reconcile one already-dispatched computer claim.
 *
 * History owns the persisted computer lifecycle, profile resolution admits release-owned claim
 * coordinates, and read-only observations verify controller status and Pod ownership. Separating
 * those ports prevents a status pass from selecting a claim, profile, Pod, or lease deadline.
 */
export interface ConversationComputerSandboxReconciliationAuthorityDependencies
{
	/** Loads and revision-fences the authoritative computer and lease snapshots. */
	readonly history: Pick<ConversationComputerHistory, "append" | "loadForActivation">;
	/** Resolves the release-owned Sandbox coordinates for the profile fixed by history. */
	readonly profiles: ConversationComputerActivationProfileResolver;
	/** Reads only the exact immutable SandboxClaim that the checked lease recorded. */
	readonly observations: AgentSandboxClaimObservationReader;
	/** Reads only the exact controller-owned Pod that a ready assigned Sandbox identifies. */
	readonly runtimePods: AgentSandboxRuntimePodReader;
	/** Supplies the server-owned instant that determines whether a pending lease has expired. */
	readonly clock: ConversationComputerActivationClock;
}
