import type { ConversationComputerExecution } from "@opencrane/contracts";

import type { ConversationComputerActivationCurrentCommand } from "./conversation-computer-history.types";

/**
 * Names the caller-safe coordinates for beginning the loop on one computer that the server selected.
 *
 * History derives the agent identity and profile revision from this locator before the authority
 * decides whether the computer has a current warm lease. The caller therefore cannot select an
 * execution, lease, profile, or identity.
 *
 * Called by: the future ConversationComputer loop composition.
 */
export interface ConversationComputerExecutionStartCommand extends ConversationComputerActivationCurrentCommand
{
}

/**
 * States what happened when the server tried to begin a ConversationComputer execution.
 *
 * These values guide the loop composition after it has read computer history. They are not stored:
 * a started or already-active result carries the execution that history owns, while unavailable
 * means the caller must not contact a sandbox. An unknown result must be treated as unavailable.
 */
export enum ConversationComputerExecutionStartOutcomes
{
	/** The authority appended the first open execution under the current computer stream revision. */
	Started = "started",
	/** The current active lease already owns an open execution, so the caller must reuse it. */
	AlreadyActive = "already_active",
	/** No unexpired warm active lease without a terminal execution was available for a loop. */
	Unavailable = "unavailable",
}

/**
 * Returns the computer execution that a target loop may use, or records that no loop may start.
 *
 * `Started` and `AlreadyActive` both supply the fenced execution the caller must use. `Unavailable`
 * supplies `null`, so a caller cannot create a transport session from a cold, expired, replaced, or
 * terminal computer state.
 *
 * Called by: the future ConversationComputer loop composition.
 */
export interface ConversationComputerExecutionStartResult
{
	/** States whether this call appended an execution, reused one, or found no usable lease. */
	readonly outcome: ConversationComputerExecutionStartOutcomes;
	/** Carries the execution fixed by checked history, or null when contacting a sandbox is forbidden. */
	readonly execution: ConversationComputerExecution | null;
}

/**
 * Supplies server-owned time for the execution fence.
 *
 * Called by: ConversationComputerExecutionAuthority.
 */
export interface ConversationComputerExecutionClock
{
	/** Returns the server time used to reject an expired lease before an execution is appended. */
	now(): Date;
}
