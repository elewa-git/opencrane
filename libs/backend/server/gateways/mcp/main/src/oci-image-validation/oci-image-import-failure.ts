/** Carries whether a failed registry import may succeed on a later workflow attempt. */
export class OciImageImportFailure extends Error
{
	/** True when the workflow should retry before it stores a final rejection. */
	readonly retryable: boolean;

	/** Creates a credential-free workflow error. */
	constructor(message: string, retryable: boolean)
	{
		super(message);
		this.name = "OciImageImportFailure";
		this.retryable = retryable;
	}
}
