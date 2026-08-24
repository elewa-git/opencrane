import { LocalDevelopmentProfileKinds, type LocalDevelopmentIdentity } from "./local-development-profile.types";

/** Stable profile values accepted when process environments select a Tier 2 composition. */
const _LOCAL_DEVELOPMENT_PROFILE_KINDS = new Set<string>(Object.values(LocalDevelopmentProfileKinds));

/** Return whether an untrusted process value selects one supported Tier 2 profile. */
export function __IsLocalDevelopmentProfileKind(value: unknown): value is LocalDevelopmentProfileKinds
{
	return typeof value === "string" && _LOCAL_DEVELOPMENT_PROFILE_KINDS.has(value);
}

/** Fixed human identity seeded and selected by every Tier 2 application profile. */
export const LOCAL_DEVELOPMENT_IDENTITY: LocalDevelopmentIdentity = Object.freeze({
	subjectId: "local-development-user",
	email: "developer@opencrane.local",
	displayName: "Local Developer",
	siloId: "local-development",
});

/** Issuer stored with the disposable development membership revision. */
export const LOCAL_DEVELOPMENT_MEMBERSHIP_ISSUER_ID = "local-development-issuer";

/** Ed25519 key identifier stored with the disposable development membership revision. */
export const LOCAL_DEVELOPMENT_MEMBERSHIP_KEY_ID = "local-development-key";

/** Personal-scope assertion selected when the fixed development user admits a run. */
export const LOCAL_DEVELOPMENT_MEMBERSHIP_ASSERTION_ID = "local-development-personal-membership";
