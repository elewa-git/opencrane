import { isAbsolute } from "node:path";

import { __ParseLocalDevelopmentProfileKind, LOCAL_DEVELOPMENT_IDENTITY, LocalDevelopmentProfileKinds } from "@opencrane/models/local-development";

/** Read one bounded local listener port. */
function _ReadPort(name: string, fallback: number): number
{
	const value = Number(process.env[name] ?? fallback);

	if (!Number.isSafeInteger(value) || value < 1_024 || value > 65_535)
	{
		throw new Error(`${name} must be a local user port`);
	}

	return value;
}

/** Read the explicit core or Agent application composition. */
function _ReadProfile(): LocalDevelopmentProfileKinds
{
	const value = process.env.OPENCRANE_DEVELOPMENT_PROFILE?.trim() || LocalDevelopmentProfileKinds.Core;
	const profile = __ParseLocalDevelopmentProfileKind(value);

	if (!profile)
	{
		throw new Error("OPENCRANE_DEVELOPMENT_PROFILE must be core, agent-local, agent-remote, or agent-simulated");
	}

	return profile;
}

/** Require an absolute private identity path for Agent profiles and omit it from core. */
function _ReadAgentSecretPath(name: string, profile: LocalDevelopmentProfileKinds): string | null
{
	if (profile === LocalDevelopmentProfileKinds.Core)
	{
		return null;
	}

	const value = process.env[name]?.trim();

	if (!value || !isAbsolute(value))
	{
		throw new Error(`${name} must be an absolute path for a Tier 2 Agent profile`);
	}

	return value;
}

/** Refuse the development entrypoint against production process or database coordinates. */
function _AssertDevelopmentBoundary(): void
{
	if (process.env.OPENCRANE_DEVELOPMENT_ENTRYPOINT !== "true" || process.env.NODE_ENV === "production")
	{
		throw new Error("Tier 2 server requires an explicit non-production development entrypoint");
	}

	const databaseUrl = process.env.DATABASE_URL?.trim();

	if (!databaseUrl)
	{
		throw new Error("DATABASE_URL is required for the Tier 2 server");
	}

	const database = new URL(databaseUrl);

	if (database.hostname !== "127.0.0.1" && database.hostname !== "localhost")
	{
		throw new Error("Tier 2 server refuses a non-loopback PostgreSQL server");
	}
}

/** Read and validate the complete Tier 2 server configuration before composing any adapter. */
export function _ReadDevelopmentConfig()
{
	// 1. Establish the development-only process and database fence before accepting configuration.
	_AssertDevelopmentBoundary();

	// 2. Bind the fixed user and silo to the values the app-owned seed writes.
	const membershipPublicKeyPath = process.env.OPENCRANE_DEVELOPMENT_MEMBERSHIP_PUBLIC_KEY_PATH?.trim();

	if (!membershipPublicKeyPath || !isAbsolute(membershipPublicKeyPath))
	{
		throw new Error("OPENCRANE_DEVELOPMENT_MEMBERSHIP_PUBLIC_KEY_PATH must be absolute");
	}

	// 3. Freeze the selected capability profile and loopback listener coordinates for all consumers.
	const profile = _ReadProfile();
	return Object.freeze({
		profile,
		identity: LOCAL_DEVELOPMENT_IDENTITY,
		membershipPublicKeyPath,
		controllerTokenPath: _ReadAgentSecretPath("OPENCRANE_CONTROLLER_TOKEN_PATH", profile),
		runtimeLaunchSecretPath: _ReadAgentSecretPath("OPENCRANE_RUNTIME_LAUNCH_SECRET_PATH", profile),
		publicPort: _ReadPort("PORT", 8_080),
		internalPort: _ReadPort("INTERNAL_PORT", 8_081),
	});
}
