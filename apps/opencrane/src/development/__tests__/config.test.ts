import { afterEach, describe, expect, it, vi } from "vitest";

import { _ReadDevelopmentConfig } from "../config";
import { DevelopmentProfileKinds } from "../config.types";

/** Restore process settings after every boundary test. */
afterEach(function _RestoreEnvironment(): void
{
	vi.unstubAllEnvs();
});

/** Configure the smallest explicit development boundary. */
function _ConfigureDevelopment(): void
{
	vi.stubEnv("DATABASE_URL", "postgresql://opencrane:opencrane@127.0.0.1:5432/opencrane");
	vi.stubEnv("OPENCRANE_LOCAL_BROWSER_SESSION_CREDENTIAL_PATH", "/tmp/opencrane-tier2/browser-session");
	vi.stubEnv("OPENCRANE_LOCAL_CONVERSATION_KEYRING_PATH", "/tmp/opencrane-tier2/keyring.json");
	vi.stubEnv("OPENCRANE_LOCAL_DEVELOPMENT", "true");
	vi.stubEnv("OPENCRANE_LOCAL_INVITATION_SIGNING_KEY_PATH", "/tmp/opencrane-tier2/invitation.key");
	vi.stubEnv("OPENCRANE_LOCAL_KURRENTDB_CA_PATH", "/tmp/opencrane-tier2/ca.pem");
	vi.stubEnv("OPENCRANE_LOCAL_KURRENTDB_ENDPOINT", "127.0.0.1:21139");
	vi.stubEnv("OPENCRANE_LOCAL_KURRENTDB_PASSWORD_PATH", "/tmp/opencrane-tier2/kurrent-password");
	vi.stubEnv("OPENCRANE_LOCAL_KURRENTDB_USERNAME_PATH", "/tmp/opencrane-tier2/kurrent-username");
	vi.stubEnv("NODE_ENV", "development");
}

describe("Tier 2 development configuration", function _Suite(): void
{
	it("defaults to core with the seeded identity", function _ReadsCore(): void
	{
		_ConfigureDevelopment();
		const config = _ReadDevelopmentConfig();
		expect(config.profile).toBe(DevelopmentProfileKinds.Core);
		expect(config.identity).toMatchObject({ principalId: "local-development-principal", siloId: "local-development", subjectId: "local-development-user" });
		expect(config.historyStore.endpoint).toBe("127.0.0.1:21139");
	});

	it("refuses a non-loopback KurrentDB endpoint", function _RejectsRemoteHistory(): void
	{
		_ConfigureDevelopment();
		vi.stubEnv("OPENCRANE_LOCAL_KURRENTDB_ENDPOINT", "history.example.test:2113");
		expect(function _Read(): void { _ReadDevelopmentConfig(); }).toThrow("loopback host");
	});

	it("refuses a non-loopback database", function _RejectsRemoteDatabase(): void
	{
		_ConfigureDevelopment();
		vi.stubEnv("DATABASE_URL", "postgresql://opencrane:opencrane@database.example.test:5432/opencrane");
		expect(function _Read(): void { _ReadDevelopmentConfig(); }).toThrow("non-loopback");
	});

	it("refuses a production process", function _RejectsProduction(): void
	{
		_ConfigureDevelopment();
		vi.stubEnv("NODE_ENV", "production");
		expect(function _Read(): void { _ReadDevelopmentConfig(); }).toThrow("non-production");
	});
});
