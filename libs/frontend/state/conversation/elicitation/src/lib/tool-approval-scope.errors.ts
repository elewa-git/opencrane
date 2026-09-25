/** Failure categories that determine whether a revocation may be retried with the same key. */
export enum ToolApprovalScopeGatewayErrorKinds
{
	/** Current authentication or requester ownership was refused. */
	Forbidden = "forbidden",
	/** A read failed before returning an authoritative page. */
	Unavailable = "unavailable",
	/** A revocation may have reached the server but its result was not confirmed. */
	Uncertain = "uncertain",
}

/** Safe user-facing fallback for each adapter failure category. */
const ERROR_MESSAGES: Readonly<Record<ToolApprovalScopeGatewayErrorKinds, string>> = {
	[ToolApprovalScopeGatewayErrorKinds.Forbidden]: "Your access changed. Refresh your sign-in and try again.",
	[ToolApprovalScopeGatewayErrorKinds.Unavailable]: "Standing approvals are unavailable right now.",
	[ToolApprovalScopeGatewayErrorKinds.Uncertain]: "OpenCrane could not confirm whether this approval was revoked.",
};

/** Bounded adapter failure with no server body or credential detail. */
export class ToolApprovalScopeGatewayError extends Error
{
	/** Stable category used by the state owner. */
	public readonly kind: ToolApprovalScopeGatewayErrorKinds;

	/** Build one safe adapter failure. */
	public constructor(kind: ToolApprovalScopeGatewayErrorKinds)
	{
		super(ERROR_MESSAGES[kind]);
		this.name = "ToolApprovalScopeGatewayError";
		this.kind = kind;
	}
}
