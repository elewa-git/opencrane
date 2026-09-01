import { LOCAL_DEVELOPMENT_MEMBERSHIP_ISSUER_ID, LOCAL_DEVELOPMENT_MEMBERSHIP_KEY_ID } from "@opencrane/models/local-development";

/** Maximum age of the disposable signed membership before a fresh coordinator seed is required. */
const _MAXIMUM_STALENESS_MILLISECONDS = 24 * 60 * 60 * 1_000;

/**
 * Builds fleet-mode membership settings from the coordinator-created public key path.
 *
 * Tier 2 passes these settings through the production evidence factories at startup so run
 * admission and runtime external-action checks trust the same issuer, key, and staleness limit.
 *
 * Called by: `_Main` in `development/index.ts` before it composes either membership authority.
 * @param publicKeyPath - Absolute path to the disposable coordinator public key.
 * @returns The fleet-mode environment accepted by the production membership evidence factories.
 */
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
