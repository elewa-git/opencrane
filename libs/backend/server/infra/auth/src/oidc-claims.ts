import * as client from "openid-client";
import type { Logger } from "pino";

import { _ResolveIdentityClaims } from "./identity-claims";
import type { OidcAuthConfig } from "./oidc-config.types";
import type { AuthUser } from "./session.types";

/** Merges UserInfo onto verified ID-token claims when the provider supplies an access token. */
export async function ___ResolveOidcClaims(discoveredConfig: client.Configuration, accessToken: string | undefined, claims: Record<string, unknown>, log: Logger): Promise<Record<string, unknown>>
{
	if (!accessToken || typeof claims.sub !== "string") return claims;
	try
	{
		const userInfo = await client.fetchUserInfo(discoveredConfig, accessToken, claims.sub);
		return { ...claims, ...userInfo, sub: claims.sub, exp: claims.exp };
	}
	catch (err)
	{
		log.warn({ err }, "failed to fetch OIDC userinfo; continuing with ID token claims only");
		return claims;
	}
}

/** Validates merged OIDC claims and creates the bounded browser-session identity. */
export function ___BuildOidcAuthUser(claims: Record<string, unknown>, config: OidcAuthConfig): AuthUser
{
	const subject = typeof claims.sub === "string" ? claims.sub : "";
	if (!subject) throw new Error("OIDC login succeeded without a usable subject claim");
	const expiresAtSeconds = typeof claims.exp === "number" ? claims.exp : Number.NaN;
	if (!Number.isSafeInteger(expiresAtSeconds) || expiresAtSeconds * 1000 <= Date.now()) throw new Error("OIDC login succeeded without a current token expiry");
	const email = typeof claims.email === "string" ? claims.email.trim().toLowerCase() : undefined;
	const emailVerified = typeof claims.email_verified === "boolean" ? claims.email_verified : undefined;
	if ((config.allowedEmailDomains.length || config.allowedEmails.length) && !email) throw new Error("An email claim is required for the configured OIDC allowlist");
	if (emailVerified === false) throw new Error("OIDC login was rejected because the email claim is not verified");
	if (email && config.allowedEmails.length && !config.allowedEmails.includes(email))
	{
		const domain = email.split("@")[1] ?? "";
		if (!config.allowedEmailDomains.includes(domain)) throw new Error(`OIDC login is not allowed for ${email}`);
	}
	if (email && !config.allowedEmails.length && config.allowedEmailDomains.length)
	{
		const domain = email.split("@")[1] ?? "";
		if (!config.allowedEmailDomains.includes(domain)) throw new Error(`OIDC login is not allowed for ${email}`);
	}
	const identity = _ResolveIdentityClaims(claims, config, email);
	return {
		sub: subject,
		issuer: config.issuerUrl,
		groups: identity.groups,
		authorizationExpiresAt: new Date(expiresAtSeconds * 1000).toISOString(),
		isPlatformOperator: identity.isPlatformOperator,
		...(email ? { email } : {}),
		...(emailVerified !== undefined ? { emailVerified } : {}),
		...(typeof claims.name === "string" ? { name: claims.name } : {}),
		...(typeof claims.picture === "string" ? { picture: claims.picture } : {}),
		authenticatedAt: new Date().toISOString(),
	};
}
