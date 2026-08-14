import createClient, { Client, Middleware } from "openapi-fetch";

import { _CreateOpenCraneApiError } from "./api-error";

/**
 * Shared base for the frontend's typed OpenCrane clients.
 *
 * OpenCrane exposes two opencrane-ui surfaces (Control Plane API + Fleet Manager
 * API), each served at its own origin and each owning its own OIDC `/auth`
 * endpoints. Both clients are therefore **self-contained**: each builds its
 * openapi-fetch client against its own `/api/v1` base, carries the cookie session
 * (`credentials: "include"`), and redirects to **its own** `/auth/login` on a 401.
 * Subclasses only supply their generated `paths` type and their base origin.
 *
 * Uses native fetch (not Angular HttpClient), so cross-cutting concerns are
 * applied as openapi-fetch middleware here rather than HTTP interceptors.
 */
export abstract class OpenCraneApiClientBase<TPaths extends object>
{
	/** Versioned API base (the generated paths are relative to `/api/v1`). */
	protected readonly _baseUrl: string;

	/** Typed openapi-fetch client over the subclass's generated contract paths. */
	public readonly client: Client<TPaths>;

	/**
	 * @param _origin - Origin of this surface's API; empty string means same-origin.
	 */
	protected constructor(protected readonly _origin: string)
	{
		this._baseUrl = `${this._origin}/api/v1`;
		this.client = createClient<TPaths>({ baseUrl: this._baseUrl, credentials: "include" });
		this.client.use(this._buildAuthMiddleware());
	}

	/**
	 * Issue a JSON request to a path not yet present in the pinned OpenAPI
	 * contract. Reuses the same versioned base, cookie session, and 401→login
	 * behaviour as {@link client} — only the typing is local: the caller supplies
	 * the response shape until the path is generated into `paths`.
	 *
	 * @param method  - HTTP method (`GET`, `POST`, `PUT`, `DELETE`, …).
	 * @param path    - Path relative to the `/api/v1` base (must start with `/`).
	 * @param options - Optional JSON `body` and `query` params.
	 * @returns The parsed JSON response body, or `undefined` for a 204.
	 * @throws OpenCraneApiError with the public code and field issues when the response is not 2xx.
	 */
	public async request<TResponse>(method: string, path: string, options?: { body?: unknown; query?: Record<string, string | number | boolean> }): Promise<TResponse>
	{
		const search = options?.query ? this._queryString(options.query) : "";
		const init: RequestInit = { method, credentials: "include", headers: { "Content-Type": "application/json" } };
		if (options?.body !== undefined)
		{
			init.body = JSON.stringify(options.body);
		}
		const response = await fetch(`${this._baseUrl}${path}${search}`, init);
		this._redirectIfUnauthorized(response);
		if (!response.ok)
		{
			throw await _CreateOpenCraneApiError(response, method, path);
		}
		if (response.status === 204)
		{
			return undefined as TResponse;
		}
		return (await response.json()) as TResponse;
	}

	/**
	 * Builds the OIDC login URL for **this** surface, carrying a percent-encoded
	 * `returnTo` so the backend can bounce the user back after authentication.
	 *
	 * @param returnTo - Post-login destination (typically a path + query).
	 * @returns The absolute (or same-origin) `/api/v1/auth/login` URL.
	 */
	public signInUrl(returnTo: string): string
	{
		return `${this._origin}/api/v1/auth/login?returnTo=${encodeURIComponent(returnTo)}`;
	}

	/**
	 * Proactively redirects the browser to this surface's OIDC login flow. Used for
	 * the anonymous case (`GET /auth/me` → `authenticated:false`, HTTP 200), which
	 * the 401 middleware never sees. No-op outside a browser (SSR).
	 *
	 * @param returnTo - Optional post-login destination; defaults to the current
	 *   location's path + query.
	 */
	public signIn(returnTo?: string): void
	{
		if (typeof window !== "undefined")
		{
			window.location.assign(this.signInUrl(returnTo ?? window.location.pathname + window.location.search));
		}
	}

	/**
	 * Builds the OIDC login URL for **this** surface, carrying the prompt=create parameter
	 * to trigger the Zitadel registration form, and a percent-encoded `returnTo`.
	 *
	 * @param returnTo - Post-login destination (typically a path + query).
	 * @returns The absolute (or same-origin) `/api/v1/auth/login?prompt=create` URL.
	 */
	public signUpUrl(returnTo: string): string
	{
		return `${this._origin}/api/v1/auth/login?prompt=create&returnTo=${encodeURIComponent(returnTo)}`;
	}

	/**
	 * Proactively redirects the browser to this surface's OIDC login flow with prompt=create
	 * to show the registration form. No-op outside a browser (SSR).
	 *
	 * @param returnTo - Optional post-login destination; defaults to the current
	 *   location's path + query.
	 */
	public signUp(returnTo?: string): void
	{
		if (typeof window !== "undefined")
		{
			window.location.assign(this.signUpUrl(returnTo ?? window.location.pathname + window.location.search));
		}
	}

	/** Serialise a query map into a `?a=1&b=2` string (empty when no params). */
	private _queryString(query: Record<string, string | number | boolean>): string
	{
		const params = new URLSearchParams();
		for (const [key, value] of Object.entries(query))
		{
			params.set(key, String(value));
		}
		const serialised = params.toString();
		return serialised ? `?${serialised}` : "";
	}

	/** Redirect to this surface's OIDC login flow on a 401 (shared by the client middleware and {@link request}). */
	private _redirectIfUnauthorized(response: Response): void
	{
		if (response.status === 401 && typeof window !== "undefined")
		{
			window.location.assign(this.signInUrl(window.location.pathname + window.location.search));
		}
	}

	/**
	 * Middleware that redirects to this surface's OIDC login flow on a 401 from a
	 * protected endpoint. `/auth/me` returns 200 (anonymous) rather than 401, so
	 * this fires only when an established session is missing or expired mid-use.
	 */
	private _buildAuthMiddleware(): Middleware
	{
		const redirectIfUnauthorized = this._redirectIfUnauthorized.bind(this);
		return {
			onResponse: function _onResponse({ response }): Response
			{
				redirectIfUnauthorized(response);
				return response;
			}
		};
	}
}
