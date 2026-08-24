import type { LocalDevelopmentIdentity } from "./local-development-profile.types";

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
