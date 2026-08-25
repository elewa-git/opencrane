import { LOCAL_DEVELOPMENT_MEMBERSHIP_ISSUER_ID, LOCAL_DEVELOPMENT_MEMBERSHIP_KEY_ID } from "@opencrane/models/local-development";

/** Maximum age of the disposable signed membership before a fresh coordinator seed is required. */
const _MAXIMUM_STALENESS_MILLISECONDS = 24 * 60 * 60 * 1_000;

/** Build the membership environment consumed by the production evidence factories. */
export function _CreateDevelopmentMembershipEnvironment(publicKeyPath: string): NodeJS.ProcessEnv
{
	return {
		OPENCRANE_MEMBERSHIP_MODE: "fleet",
		OPENCRANE_MEMBERSHIP_ISSUER_ID: LOCAL_DEVELOPMENT_MEMBERSHIP_ISSUER_ID,
		OPENCRANE_MEMBERSHIP_KEY_ID: LOCAL_DEVELOPMENT_MEMBERSHIP_KEY_ID,
		OPENCRANE_MEMBERSHIP_PUBLIC_KEY_FILE: publicKeyPath,
		OPENCRANE_MEMBERSHIP_MAX_STALENESS_MS: String(_MAXIMUM_STALENESS_MILLISECONDS)
	};
}
