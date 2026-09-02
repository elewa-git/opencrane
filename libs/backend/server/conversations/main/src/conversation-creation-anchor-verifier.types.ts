import type { ConversationCreated } from "@opencrane/contracts";

/** States whether a read-only recovery check proved the exact reserved creation anchor. */
export enum ConversationCreationAnchorConfirmationOutcomes
{
	/** The conversation stream has no first event, so one append retry remains permissible. */
	Absent = "absent",
	/** Revision zero contains the exact reserved creation envelope and payload. */
	Confirmed = "confirmed",
}

/** Carries the fixed creation record that a response-lost history retry must prove already exists. */
export interface ConfirmConversationCreationAnchorCommand
{
	/** Identifies the silo that must match the stored history envelope. */
	readonly siloId: string;
	/** Supplies the complete immutable creation payload reserved before the history append. */
	readonly created: ConversationCreated;
	/** Supplies the reserved UUID that must be the revision-zero event and idempotency key. */
	readonly eventId: string;
}

/** Separates an absent stream from a proven reservation match without treating a foreign stream as recoverable. */
export type ConversationCreationAnchorConfirmation
	= { readonly outcome: ConversationCreationAnchorConfirmationOutcomes.Absent }
	| { readonly outcome: ConversationCreationAnchorConfirmationOutcomes.Confirmed; readonly revision: 0n };
