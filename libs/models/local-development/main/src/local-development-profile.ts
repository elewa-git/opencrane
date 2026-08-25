import profileContract from "../profile-contract.json";

import type { LocalDevelopmentIdentity, LocalDevelopmentRuntimeIdentities } from "./local-development-profile.types";

/** Fixed human identity seeded and selected by every Tier 2 application profile. */
export const LOCAL_DEVELOPMENT_IDENTITY: LocalDevelopmentIdentity = Object.freeze({
	subjectId: "local-development-user",
	email: "developer@opencrane.local",
	displayName: "Local Developer",
	siloId: "local-development",
});

/** Stable local Principal row selected after the Tier 2 session passes its host checks. */
export const LOCAL_DEVELOPMENT_PRINCIPAL_ID = "local-development-principal";

/** Fixed issuer stored with the Tier 2 local Principal and authenticated request context. */
export const LOCAL_DEVELOPMENT_PRINCIPAL_ISSUER = "opencrane-local-development";

/** Runtime coordinates shared by the Tier 2 coordinator, controller, and server verifier. */
export const LOCAL_DEVELOPMENT_RUNTIME_IDENTITIES: LocalDevelopmentRuntimeIdentities = Object.freeze({
	serverNamespace: profileContract.runtimeIdentities.serverNamespace,
	personal: Object.freeze({ ...profileContract.runtimeIdentities.personal }),
	managed: Object.freeze({ ...profileContract.runtimeIdentities.managed }),
});

/** Issuer stored with the disposable development membership revision. */
export const LOCAL_DEVELOPMENT_MEMBERSHIP_ISSUER_ID = "local-development-issuer";

/** Ed25519 key identifier stored with the disposable development membership revision. */
export const LOCAL_DEVELOPMENT_MEMBERSHIP_KEY_ID = "local-development-key";

/** Personal-scope assertion selected when the fixed development user admits a run. */
export const LOCAL_DEVELOPMENT_MEMBERSHIP_ASSERTION_ID = "local-development-personal-membership";
