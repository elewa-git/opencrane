import { afterEach, describe, expect, it, vi } from "vitest";

import { _CreateHumanMembershipEvidenceConfig, FleetMembershipDeploymentModes } from "@opencrane/backend/server/iam/membership";

import { _ReadDevelopmentConfig, _SetDevelopmentMembershipEnvironment } from "../config";
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
		expect(config.identity).toMatchObject({
			principalId: "local-development-principal",
			siloId: "local-development",
			subjectId: "local-development-user",
		});
		expect(config.historyStore.endpoint).toBe("127.0.0.1:21139");
		expect(config.browserOrigin).toBe("http://local-development.localhost:4200");
	});

	it("binds the fixed standalone membership authority before product composition", function _BindsMembership(): void
	{
		_ConfigureDevelopment();
		const config = _ReadDevelopmentConfig();
		const environment: NodeJS.ProcessEnv = { OPENCRANE_MEMBERSHIP_MODE: FleetMembershipDeploymentModes.Fleet };
		_SetDevelopmentMembershipEnvironment(config, environment);
		const membership = _CreateHumanMembershipEvidenceConfig(environment);

		expect(environment.OPENCRANE_MEMBERSHIP_MODE).toBe(FleetMembershipDeploymentModes.Standalone);
		expect(environment.OPENCRANE_SILO_ID).toBe(config.identity.siloId);
		expect(environment.OIDC_ISSUER_URL).toBe(config.identity.issuer);
		expect(environment.OPENCRANE_MEMBERSHIP_TRUSTED_IDENTITY_ISSUER).toBe(config.identity.issuer);
		expect(environment.OPENCRANE_MEMBERSHIP_MAX_STALENESS_MS).toBe("300000");
		const expectedMembership = {
			mode: FleetMembershipDeploymentModes.Standalone,
			siloId: config.identity.siloId,
			trustedIdentityIssuer: config.identity.issuer,
			maximumStalenessMs: 300_000,
		};
		expect(membership).toMatchObject(expectedMembership);
	});

	it("refuses membership binding outside the validated development boundary", function _RejectsMembershipBinding(): void
	{
		_ConfigureDevelopment();
		const config = _ReadDevelopmentConfig();
		const environment: NodeJS.ProcessEnv = {};
		vi.stubEnv("NODE_ENV", "production");
		expect(function _BindProduction(): void { _SetDevelopmentMembershipEnvironment(config, environment); }).toThrow("non-production");
		expect(environment).toEqual({});

		vi.stubEnv("NODE_ENV", "development");
		vi.stubEnv("DATABASE_URL", "postgresql://opencrane:opencrane@database.example.test:5432/opencrane");
		expect(function _ReadRemote(): void { _ReadDevelopmentConfig(); }).toThrow("non-loopback");
		expect(environment).toEqual({});
	});

	it("keeps the shared membership factory fail-closed", function _RejectsMissingMembershipMode(): void
	{
		expect(function _ReadMissing(): void { _CreateHumanMembershipEvidenceConfig({}); }).toThrow("must be standalone or fleet");
		expect(function _ReadUnknown(): void { _CreateHumanMembershipEvidenceConfig({ OPENCRANE_MEMBERSHIP_MODE: "unknown" }); }).toThrow("must be standalone or fleet");
	});

	it("accepts only the exact private Codespaces browser origin", function _CodespaceOrigin(): void
	{
		_ConfigureDevelopment();
		vi.stubEnv("CODESPACES", "true");
		vi.stubEnv("CODESPACE_NAME", "careful-crane-123");
		vi.stubEnv("GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN", "app.github.dev");
		vi.stubEnv("OPENCRANE_LOCAL_BROWSER_ORIGIN", "https://careful-crane-123-4200.app.github.dev");
		expect(_ReadDevelopmentConfig().browserOrigin).toBe("https://careful-crane-123-4200.app.github.dev");

		vi.stubEnv("OPENCRANE_LOCAL_BROWSER_ORIGIN", "https://other-4200.app.github.dev");
		expect(function _Read(): void { _ReadDevelopmentConfig(); }).toThrow("exact private Codespaces");
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
