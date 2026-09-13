import type { PersonalMemoryOperationKinds } from "@opencrane/backend/agents/personal/memory";

/** Public coordinates selecting one immutable human message without supplying its content. */
export interface PersonalMemoryCommandSourceSelection
{
	/** Conversation to which the authenticated caller must retain current access. */
	readonly conversationId: string;
	/** Human message whose author must be the authenticated caller. */
	readonly messageId: string;
	/** Exact immutable stream position used for a bounded source read. */
	readonly messagePosition: string;
}

/** Explicit personal-memory request; identity, dataset and provider coordinates are server-selected. */
export type PersonalMemoryCommand =
	| {
		/** Stable command UUID reused after an uncertain response. */
		readonly commandId: string;
		/** A new fact needs one authorized human source. */
		readonly kind: PersonalMemoryOperationKinds.Remember;
		/** Exact source selected by the caller. */
		readonly source: PersonalMemoryCommandSourceSelection;
	}
	| {
		/** Stable command UUID reused after an uncertain response. */
		readonly commandId: string;
		/** A correction retains the old fact until its replacement is indexed. */
		readonly kind: PersonalMemoryOperationKinds.Correct;
		/** New source selected by the caller. */
		readonly source: PersonalMemoryCommandSourceSelection;
		/** Exact fact in the caller's personal scope to replace. */
		readonly targetFactId: string;
		/** Revision observed when the caller requested the correction. */
		readonly expectedFactRevision: number;
	}
	| {
		/** Stable command UUID reused after an uncertain response. */
		readonly commandId: string;
		/** Forget hides the exact fact as soon as admission commits. */
		readonly kind: PersonalMemoryOperationKinds.Forget;
		/** Exact fact in the caller's personal scope to forget. */
		readonly targetFactId: string;
		/** Revision observed when the caller requested forgetting. */
		readonly expectedFactRevision: number;
	};

/** Denies a memory command without exposing source, dataset or provider details. */
export class PersonalMemoryCommandDenied extends Error
{
	/** Produces the same safe failure for missing or ended command authority. */
	public constructor()
	{
		super("This personal memory command is unavailable.");
		this.name = "PersonalMemoryCommandDenied";
	}
}
