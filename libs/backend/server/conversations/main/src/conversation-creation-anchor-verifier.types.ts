import type { ConversationCreated } from "@opencrane/contracts";

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
	= { readonly outcome: "absent" }
	| { readonly outcome: "confirmed"; readonly revision: 0n };
