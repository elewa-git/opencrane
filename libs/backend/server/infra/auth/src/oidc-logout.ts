import type { Request } from "express";
import * as client from "openid-client";
import type { Logger } from "pino";

import type { OidcAuthConfig } from "./oidc-config.types";
import { _buildPostLogoutRedirectUri } from "./session";

/** Builds the optional provider logout URL while keeping local logout independent of provider availability. */
export async function ___BuildOidcEndSessionUrl(request: Request, config: OidcAuthConfig, discover: () => Promise<client.Configuration>, log: Logger): Promise<string | null>
{
	if (!config.enabled) return null;
	const idToken = request.session?.idToken;
	if (typeof idToken !== "string" || idToken === "") return null;
	try
	{
		const discoveredConfig = await discover();
		if (!discoveredConfig.serverMetadata().end_session_endpoint) return null;
		const params: Record<string, string> = { id_token_hint: idToken };
		if (config.postLogoutRedirectUri) params.post_logout_redirect_uri = _buildPostLogoutRedirectUri(request, config.postLogoutRedirectUri);
		return client.buildEndSessionUrl(discoveredConfig, params).href;
	}
	catch (err)
	{
		log.warn({ err }, "failed to build OIDC end-session URL; logging out locally only");
		return null;
	}
}
