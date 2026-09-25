import { CogneeProviderSessionFailureCodes } from "./cognee-provider-session.types";

/** Secret-free provider session failure safe for readiness and operation classification. */
export class CogneeProviderSessionError extends Error
{
	/** Stable category containing no provider body, credential, or bearer material. */
	readonly code: CogneeProviderSessionFailureCodes;

	/** Create one failure whose message contains only its stable category. */
	constructor(code: CogneeProviderSessionFailureCodes)
	{
		super(`Cognee provider session failed: ${code}`);
		this.name = "CogneeProviderSessionError";
		this.code = code;
	}
}
