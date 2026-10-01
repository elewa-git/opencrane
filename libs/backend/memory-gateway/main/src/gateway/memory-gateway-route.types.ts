/** One private gateway route selected before authentication or request-body reads. */
export interface MemoryGatewayRoute
{
	/** Shared path template used for logs without recording caller-supplied coordinates. */
	readonly path: string;
	/** Whether an uncertain provider response could conceal a write. */
	readonly mutation: boolean;
	/** Whether the route takes its coordinates from the URL and requires an empty body. */
	readonly pathOnly: boolean;
	/** Validate the request, call its provider operation, and validate the returned receipt. */
	execute(body: unknown, signal: AbortSignal): Promise<unknown>;
}
