import { HttpBackend, type HttpEvent, type HttpRequest } from "@angular/common/http";
import { Injectable } from "@angular/core";
import { type Observable, throwError } from "rxjs";

/**
 * Replaces Angular's transport in the Tier 1 profile and rejects every `HttpClient` request. This
 * makes an omitted local gateway binding visible without allowing that request to reach a backend.
 *
 * Called by: {@link provideLocalDevelopmentGateways}, which binds this class as `HttpBackend`.
 */
@Injectable()
export class LocalDevelopmentHttpBackend extends HttpBackend
{
	/**
	 * Return an error observable for every request instead of opening a transport.
	 * @returns An observable that immediately reports the unexpected HTTP method.
	 */
	public override handle(request: HttpRequest<unknown>): Observable<HttpEvent<unknown>>
	{
		return throwError(function _UnexpectedNetwork() { return new Error(`Tier 1 local development blocked an unexpected ${request.method} request.`); });
	}
}

/**
 * Rejects native OpenCrane API requests in the Tier 1 profile.
 *
 * Called by: the generated and transitional OpenCrane clients through `OPENCRANE_API_FETCH`.
 * @param input The URL that an accidentally retained live adapter attempted to call.
 * @returns A rejected promise; no network transport is opened.
 */
export const rejectLocalDevelopmentFetch: typeof fetch = function _RejectLocalDevelopmentFetch(): Promise<Response>
{
	return Promise.reject(new Error("Tier 1 local development blocked an unexpected OpenCrane API request."));
};
