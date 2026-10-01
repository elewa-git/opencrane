import type { CogneeProviderFetch, CogneeProviderHttpCommand, CogneeProviderHttpResponse } from "../http/cognee-provider-http.types";

/** Provider credentials read from immutable application-owned files for one login attempt. */
export interface CogneeProviderCredentials
{
	/** Cognee service-user email sent only to the provider login or registration route. */
	readonly email: string;
	/** Cognee service-user password sent only to the provider login or registration route. */
	readonly password: string;
}

/** Reads the mounted Cognee service credential without caching it in the session owner. */
export interface CogneeProviderCredentialReader
{
	/** Read the current immutable credential for one login attempt. */
	read(): Promise<CogneeProviderCredentials>;
}

/**
 * Stable failure categories returned by the in-process Cognee session owner.
 *
 * They select readiness and request error handling inside memory-gateway. They are not provider
 * wire values and are not persisted. Member strings may appear in secret-free logs or health
 * diagnostics, so changing one is an internal operational contract change.
 */
export enum CogneeProviderSessionFailureCodes
{
	/** The mounted credential could not be read or did not satisfy the service-user shape. */
	CredentialsUnavailable = "credentials_unavailable",
	/** Cognee rejected the configured email and password; no authenticated session exists. */
	AuthenticationRejected = "authentication_rejected",
	/** Cognee could not complete login for a reason other than rejected credentials. */
	AuthenticationUnavailable = "authentication_unavailable",
	/** Explicit first-install registration did not create the configured service user. */
	RegistrationRejected = "registration_rejected",
	/** Cognee returned a login response outside the pinned 1.5.4 JSON contract. */
	MalformedResponse = "malformed_response",
	/** A provider response exceeded the configured in-memory response limit. */
	ResponseTooLarge = "response_too_large",
	/** The complete provider exchange exceeded its configured time limit. */
	Timeout = "timeout",
	/** The caller cancelled the provider exchange before completion. */
	Aborted = "aborted",
	/** The provider exchange failed without an HTTP response. */
	Network = "network",
	/** A request tried to escape the configured origin or override session authentication. */
	UnsafeRequest = "unsafe_request",
}

/** Construction values for one in-process Cognee provider session. */
export interface CogneeProviderSessionOptions
{
	/** Provider origin used for all login, registration, and authenticated exchanges. */
	readonly baseUrl: string;
	/** Reads the mounted credential for each login attempt. */
	readonly credentialReader: CogneeProviderCredentialReader;
	/** Per-exchange timeout covering response-body consumption. */
	readonly requestTimeoutMilliseconds: number;
	/** Maximum bytes accepted from any provider response. */
	readonly maximumResponseBytes: number;
	/** Enables one login-then-register-then-login attempt before the first session is created. */
	readonly allowFirstInstallRegistration: boolean;
	/** Optional fetch replacement used by focused tests. */
	readonly fetch?: CogneeProviderFetch;
}

/** Private authenticated Cognee exchange; it never returns credentials or bearer tokens. */
export interface CogneeProviderSession
{
	/** Establish a valid provider login without returning its bearer token. */
	ensureReady(): Promise<void>;
	/** Send one bounded request and replay it at most once after an HTTP 401. */
	exchange(command: CogneeProviderHttpCommand): Promise<CogneeProviderHttpResponse>;
}

/** Pinned Cognee 1.5.4 login response decoded only inside the session owner. */
export interface CogneeProviderLoginResponse
{
	/** Ephemeral bearer retained only by the session owner. */
	readonly accessToken: string;
}
