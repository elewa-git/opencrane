import type { PersonalMemoryOperationKinds } from "@opencrane/backend/agents/personal/memory";

import type { ConversationCaller } from "../../authorization/conversation-caller.types";
import type { PersonalMemoryCommand } from "./personal-memory-command.types";

/**
 * Describes admitted work without exposing provider phases or private source coordinates.
 * These response values are not stored; changing them changes the public API and its generated client.
 */
export enum PersonalMemoryCommandStates
{
	/** Saved work still has a provider or catalog step to finish. */
	Pending = "pending",
	/** Every required provider and catalog step has completed. */
	Completed = "completed",
	/** The saved operation needs recovery evidence before it can advance. */
	NeedsAttention = "needs_attention",
}

/**
 * Distinguishes a newly admitted command from an exact retry of saved work.
 * These response values are not stored; changing them changes the public API and its generated client.
 */
export enum PersonalMemoryCommandAdmissionOutcomes
{
	/** This transaction admitted the operation and its one workflow task. */
	Accepted = "accepted",
	/** The command already owns the returned operation and workflow task. */
	Idempotent = "idempotent",
}

/** Content-free receipt returned only after checking the current caller's access. */
export interface PersonalMemoryCommandReceipt
{
	/** Caller-selected UUID that must be reused after an uncertain command response. */
	readonly commandId: string;
	/** Immutable local operation UUID selected by the server. */
	readonly operationId: string;
	/** Explicit action saved by the original command. */
	readonly kind: PersonalMemoryOperationKinds;
	/** User-facing progress derived from the saved operation phase. */
	readonly state: PersonalMemoryCommandStates;
	/** Monotonic operation revision used to reject stale status adoption. */
	readonly revision: number;
	/** Local fact created by completed Remember or Correct work; otherwise null. */
	readonly resultFactId: string | null;
}

/** Successful admission with the exact operation that owns this command's work. */
export interface PersonalMemoryCommandAdmissionResult
{
	/** Whether this request inserted work or found its exact saved retry. */
	readonly outcome: PersonalMemoryCommandAdmissionOutcomes;
	/** Safe current projection of that operation. */
	readonly receipt: PersonalMemoryCommandReceipt;
}

/** Owns authenticated admission and status access for already provisioned personal datasets. */
export interface PersonalMemoryCommandAuthority
{
	/** Commits the decision, operation and workflow task together, or returns null when unavailable. */
	admit(caller: ConversationCaller, command: PersonalMemoryCommand): Promise<PersonalMemoryCommandAdmissionResult | null>;
	/** Reads the caller's saved command after current membership and MemoryScope Read authorization. */
	read(caller: ConversationCaller, commandId: string): Promise<PersonalMemoryCommandReceipt | null>;
}

/** Rejects reuse of a command UUID with different immutable action evidence. */
export class PersonalMemoryCommandConflict extends Error
{
	/** Keeps conflicting command contents out of the public error and logs. */
	public constructor()
	{
		super("This personal memory command conflicts with saved work.");
		this.name = "PersonalMemoryCommandConflict";
	}
}
