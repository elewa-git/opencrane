import { ___ParseApiErrorEnvelope, type ApiErrorEnvelope, type ApiValidationIssue } from "@opencrane/contracts";

/** Browser-safe HTTP failure preserving the public API code and form-mappable validation issues. */
export class OpenCraneApiError extends Error
{
	/** HTTP response status. */
	public readonly status: number;

	/** HTTP method used by the rejected request. */
	public readonly method: string;

	/** Public API path used by the rejected request. */
	public readonly path: string;

	/** Stable public error code. */
	public readonly code: string;

	/** Bounded field issues supplied by a request validation failure. */
	public readonly issues: readonly ApiValidationIssue[];

	/** Build one frontend failure without retaining server-only detail. */
	public constructor(status: number, method: string, path: string, problem: ApiErrorEnvelope)
	{
		super(problem.error);
		this.name = "OpenCraneApiError";
		this.status = status;
		this.method = method;
		this.path = path;
		this.code = problem.code;
		this.issues = problem.issues ?? [];
	}
}

/** Read one bounded public error envelope or fall back without exposing an untyped response body. */
export async function _CreateOpenCraneApiError(response: Response, method: string, path: string): Promise<OpenCraneApiError>
{
	let problem: ApiErrorEnvelope | null = null;
	try
	{
		problem = ___ParseApiErrorEnvelope(await response.json() as unknown);
	}
	catch
	{
		problem = null;
	}
	const fallback: ApiErrorEnvelope = { error: `${method} ${path} failed with HTTP ${response.status}.`, code: "HTTP_ERROR" };
	return new OpenCraneApiError(response.status, method, path, problem ?? fallback);
}
