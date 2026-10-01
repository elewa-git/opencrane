import { GovernanceReadErrorKinds } from "./governance-read.types";

/** Fixed copy prevents provider messages, response bodies, or credentials entering browser state. */
const _MESSAGES: Readonly<Record<GovernanceReadErrorKinds, string>> = {
	[GovernanceReadErrorKinds.AccessDenied]: "You do not have access to this information.",
	[GovernanceReadErrorKinds.Unauthenticated]: "Sign in again to read this information.",
	[GovernanceReadErrorKinds.Unavailable]: "This information is temporarily unavailable. Try again.",
	[GovernanceReadErrorKinds.InvalidResponse]: "This information could not be verified. Refresh to try again.",
};

/** A reporting read failure that retains no server body or underlying transport error. */
export class GovernanceReadError extends Error
{
	/** Identifies the safe failure independently from arbitrary transport errors. */
	public override readonly name = "GovernanceReadError";

	/**
	 * Stores the closed browser category and selects its static display message.
	 * @param kind - Category a screen uses for access removal, sign-in or retry state.
	 */
	public constructor(public readonly kind: GovernanceReadErrorKinds)
	{
		super(_MESSAGES[kind]);
	}
}
