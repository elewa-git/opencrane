import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { LocalDevelopmentProfileKinds } from "@opencrane/models/local-development";

import { _ReadDevelopmentConfig } from "../config";

/** Environment keys the development parser owns in these focused tests. */
const _KEYS = [
	"DATABASE_URL",
	"INTERNAL_PORT",
	"NODE_ENV",
	"OPENCRANE_DEVELOPMENT_ENTRYPOINT",
	"OPENCRANE_DEVELOPMENT_MEMBERSHIP_PUBLIC_KEY_PATH",
	"OPENCRANE_DEVELOPMENT_PROFILE",
	"OPENCRANE_CONTROLLER_TOKEN_PATH",
	"OPENCRANE_RUNTIME_LAUNCH_SECRET_PATH",
	"PORT",
] as const;

/** Original environment values restored after each parser case. */
const _original = new Map<string, string | undefined>();

describe("Tier 2 server configuration", function _Suite()
{
	beforeEach(function _SetSafeDefaults(): void
	{
		for (const key of _KEYS)
		{
			_original.set(key, process.env[key]);
			delete process.env[key];
		}
		process.env.DATABASE_URL = "postgresql://opencrane:local@127.0.0.1:55432/opencrane";
		process.env.OPENCRANE_DEVELOPMENT_ENTRYPOINT = "true";
		process.env.OPENCRANE_DEVELOPMENT_MEMBERSHIP_PUBLIC_KEY_PATH = "/tmp/opencrane-tier-2/public.pem";
	});

	afterEach(function _RestoreEnvironment(): void
	{
		for (const key of _KEYS)
		{
			const value = _original.get(key);

			if (value === undefined)
			{
				delete process.env[key];
			}
			else
			{
				process.env[key] = value;
			}
		}
	});

	it("selects the core profile and fixed local identity by default", function _ReadsCore(): void
	{
		const config = _ReadDevelopmentConfig();
		expect(config.profile).toBe(LocalDevelopmentProfileKinds.Core);
		expect(config.controllerTokenPath).toBeNull();
		expect(config.runtimeLaunchSecretPath).toBeNull();
		expect(config.identity).toEqual({
			subjectId: "local-development-user",
			email: "developer@opencrane.local",
			displayName: "Local Developer",
			siloId: "local-development",
		});
	});

	it.each([
		LocalDevelopmentProfileKinds.AgentLocal,
		LocalDevelopmentProfileKinds.AgentRemote,
		LocalDevelopmentProfileKinds.AgentSimulated,
	])("accepts the explicit Agent profile %s", function _ReadsAgentProfile(profile): void
	{
		process.env.OPENCRANE_DEVELOPMENT_PROFILE = profile;
		process.env.OPENCRANE_CONTROLLER_TOKEN_PATH = "/tmp/opencrane-tier-2/controller.token";
		process.env.OPENCRANE_RUNTIME_LAUNCH_SECRET_PATH = "/tmp/opencrane-tier-2/runtime-launch.secret";
		const config = _ReadDevelopmentConfig();
		expect(config.profile).toBe(profile);
		expect(config.controllerTokenPath).toBe(process.env.OPENCRANE_CONTROLLER_TOKEN_PATH);
		expect(config.runtimeLaunchSecretPath).toBe(process.env.OPENCRANE_RUNTIME_LAUNCH_SECRET_PATH);
	});

	it("requires both private identity paths for an Agent profile", function _RequiresIdentityFiles(): void
	{
		process.env.OPENCRANE_DEVELOPMENT_PROFILE = LocalDevelopmentProfileKinds.AgentSimulated;
		expect(_ReadDevelopmentConfig).toThrow(/OPENCRANE_CONTROLLER_TOKEN_PATH/);

		process.env.OPENCRANE_CONTROLLER_TOKEN_PATH = "/tmp/opencrane-tier-2/controller.token";
		expect(_ReadDevelopmentConfig).toThrow(/OPENCRANE_RUNTIME_LAUNCH_SECRET_PATH/);
	});

	it("refuses production, remote databases, and unknown profiles", function _RejectsUnsafeConfiguration(): void
	{
		process.env.NODE_ENV = "production";
		expect(_ReadDevelopmentConfig).toThrow(/non-production/);
		delete process.env.NODE_ENV;

		process.env.DATABASE_URL = "postgresql://opencrane:secret@database.example.com/opencrane";
		expect(_ReadDevelopmentConfig).toThrow(/non-loopback/);
		process.env.DATABASE_URL = "postgresql://opencrane:local@localhost:55432/opencrane";

		process.env.OPENCRANE_DEVELOPMENT_PROFILE = "production";
		expect(_ReadDevelopmentConfig).toThrow(/must be core/);
	});
});
