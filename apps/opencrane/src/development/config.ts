import { isAbsolute } from "node:path";

import type { DevelopmentConfig, DevelopmentIdentity } from "./config.types";
import { DevelopmentProfileKinds } from "./config.types";

/** Fixed identity shared by the database seed and browser request boundary. */
export const _DEVELOPMENT_IDENTITY: DevelopmentIdentity = Object.freeze({
	displayName: "OpenCrane developer",
	email: "developer@local.opencrane",
	issuer: "https://identity.local.opencrane",
	principalId: "local-development-principal",
	siloId: "local-development",
	subjectId: "local-development-user",
});

/** Read one bounded user-space listener port. */
function _ReadPort(name: string, fallback: number): number
{
	const value = Number(process.env[name] ?? fallback);
	if (!Number.isSafeInteger(value) || value < 1_024 || value > 65_535)
	{
		throw new Error(`${name} must be a local user port`);
	}
	return value;
}

/** Read one absolute coordinator-owned secret path. */
function _ReadAbsolutePath(name: string): string
{
	const value = process.env[name]?.trim() ?? "";
	if (!value || !isAbsolute(value))
	{
		throw new Error(`${name} must be an absolute path`);
	}
	return value;
}

/** Read one loopback KurrentDB host and port without accepting a URL or credentials. */
function _ReadKurrentEndpoint(): string
{
	const value = process.env.OPENCRANE_LOCAL_KURRENTDB_ENDPOINT?.trim() ?? "";
	const match = /^(127\.0\.0\.1|localhost):(\d{1,5})$/u.exec(value);
	const port = Number(match?.[2]);
	if (!match || !Number.isSafeInteger(port) || port < 1_024 || port > 65_535)
	{
		throw new Error("OPENCRANE_LOCAL_KURRENTDB_ENDPOINT must be a loopback host and user port");
	}
	return value;
}

/** Parse the explicit current Tier 2 composition without accepting retired runtime names. */
function _ReadProfile(): DevelopmentProfileKinds
{
	const value = process.env.OPENCRANE_LOCAL_DEVELOPMENT_PROFILE?.trim() || DevelopmentProfileKinds.Core;
	if (Object.values(DevelopmentProfileKinds).includes(value as DevelopmentProfileKinds))
	{
		return value as DevelopmentProfileKinds;
	}
	throw new Error("OPENCRANE_LOCAL_DEVELOPMENT_PROFILE must be core, agent-local, agent-remote, or agent-simulated");
}

/** Refuse production processes and non-loopback databases before a development adapter opens. */
function _AssertDevelopmentBoundary(databaseUrl: string): void
{
	if (process.env.OPENCRANE_LOCAL_DEVELOPMENT !== "true" || process.env.NODE_ENV === "production")
	{
		throw new Error("Tier 2 requires the explicit non-production development entrypoint");
	}
	const database = new URL(databaseUrl);
	if (database.protocol !== "postgresql:" && database.protocol !== "postgres:")
	{
		throw new Error("Tier 2 requires a PostgreSQL DATABASE_URL");
	}
	if (database.hostname !== "127.0.0.1" && database.hostname !== "localhost")
	{
		throw new Error("Tier 2 refuses a non-loopback PostgreSQL server");
	}
}

/**
 * Read the server boundary selected by the repository-owned Tier 2 coordinator.
 *
 * Called by: the development entrypoint before it creates any external client.
 */
export function _ReadDevelopmentConfig(): DevelopmentConfig
{
	const databaseUrl = process.env.DATABASE_URL?.trim() ?? "";
	if (!databaseUrl)
	{
		throw new Error("DATABASE_URL is required for Tier 2");
	}
	_AssertDevelopmentBoundary(databaseUrl);
	return Object.freeze({
		browserSessionCredentialPath: _ReadAbsolutePath("OPENCRANE_LOCAL_BROWSER_SESSION_CREDENTIAL_PATH"),
		conversationPrivatePayloadKeyringPath: _ReadAbsolutePath("OPENCRANE_LOCAL_CONVERSATION_KEYRING_PATH"),
		databaseUrl,
		historyStore: {
			caCertificatePath: _ReadAbsolutePath("OPENCRANE_LOCAL_KURRENTDB_CA_PATH"),
			endpoint: _ReadKurrentEndpoint(),
			passwordPath: _ReadAbsolutePath("OPENCRANE_LOCAL_KURRENTDB_PASSWORD_PATH"),
			usernamePath: _ReadAbsolutePath("OPENCRANE_LOCAL_KURRENTDB_USERNAME_PATH"),
		},
		identity: _DEVELOPMENT_IDENTITY,
		internalPort: _ReadPort("INTERNAL_PORT", 8_081),
		invitationSigningKeyPath: _ReadAbsolutePath("OPENCRANE_LOCAL_INVITATION_SIGNING_KEY_PATH"),
		profile: _ReadProfile(),
		publicPort: _ReadPort("PORT", 8_080),
	});
}
