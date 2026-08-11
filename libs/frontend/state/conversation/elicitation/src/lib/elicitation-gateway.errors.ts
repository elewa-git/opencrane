/** Browser-safe gateway error categories. */
export enum ElicitationGatewayErrorKinds
{
	Unavailable = "unavailable",
	StepUpRequired = "step_up_required",
	Conflict = "conflict",
	Forbidden = "forbidden",
}

/** Typed gateway failure without server payload leakage. */
export class ElicitationGatewayError extends Error
{
	/** Fixed safe category. */
	public readonly kind: ElicitationGatewayErrorKinds;
	/** Server-owned reauthentication path for step-up recovery. */
	public readonly reauthenticatePath: string | null;

	/** Construct a bounded gateway failure. */
	public constructor(kind: ElicitationGatewayErrorKinds, reauthenticatePath: string | null = null)
	{
		super(kind === ElicitationGatewayErrorKinds.StepUpRequired ? "Please sign in again to confirm this action." : "OpenCrane could not save this response.");
		this.name = "ElicitationGatewayError";
		this.kind = kind;
		this.reauthenticatePath = reauthenticatePath;
	}
}
