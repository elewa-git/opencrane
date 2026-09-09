import { Cookie, type SessionData } from "express-session";

import type { OidcAuthConfig } from "../oidc-config.types";
import type { OidcSessionStore } from "../oidc-session-store";

/** Creates a complete trusted deployment configuration for session-store proofs. */
export function _SessionConfig(): OidcAuthConfig
{
	return { enabled: true, issuerUrl: "https://issuer.example", clientId: "client-1", redirectUri: "https://workspace.example/api/v1/auth/callback", postLogoutRedirectUri: "", scopes: "openid", sessionSecret: "session-test-secret-with-more-than-thirty-two-bytes", cookieName: "opencrane_oidc", cookieSecure: false, sessionMaxAgeMs: 60 * 60 * 1000, allowedEmailDomains: [], allowedEmails: [], groupsClaim: "groups", rolesClaim: "roles", platformOperatorGroups: [], platformOperatorSeedEmail: "" };
}

/** Creates authenticated data with the Cookie class used by the real middleware. */
export function _SessionData(): SessionData
{
	const cookie = new Cookie();
	Object.assign(cookie, { maxAge: 60 * 60 * 1000, httpOnly: true, secure: false, sameSite: "lax", path: "/" });
	return { cookie, authUser: { sub: "person-1", issuer: "https://issuer.example", groups: [], siloId: "silo-1", authorizationExpiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(), isPlatformOperator: false, authenticatedAt: new Date(Date.now()).toISOString() }, idToken: "private-id-token" };
}

/** Waits for the store callback so assertions observe a committed save. */
export function _SaveSession(store: OidcSessionStore, id: string, data: SessionData): Promise<void>
{
	return new Promise(function _Save(resolve, reject)
	{
		store.set(id, data, function _Saved(error)
		{
			if (error)
				reject(error);
			else
				resolve();
		});
	});
}

/** Reads through the callback API consumed by express-session. */
export function _ReadSession(store: OidcSessionStore, id: string): Promise<SessionData | null>
{
	return new Promise(function _Read(resolve, reject)
	{
		store.get(id, function _Read(error, data)
		{
			if (error)
				reject(error);
			else
				resolve(data ?? null);
		});
	});
}

/** Waits for logout to commit before another instance reads the session. */
export function _DestroySession(store: OidcSessionStore, id: string): Promise<void>
{
	return new Promise(function _Destroy(resolve, reject)
	{
		store.destroy(id, function _Destroyed(error)
		{
			if (error)
				reject(error);
			else
				resolve();
		});
	});
}
