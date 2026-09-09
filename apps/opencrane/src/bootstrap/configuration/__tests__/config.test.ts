import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { _ReadAgentSandboxReleaseProfileConfig, _ReadOrganizationMembershipConfig, _ReadProcessConfig } from "../config";

const _temporaryDirectories: string[] = [];

/** Create one valid invitation signing key without depending on a deployed Secret volume. */
function _createInvitationSigningKey(): string
{
	const directory = mkdtempSync(join(tmpdir(), "opencrane-config-"));
	const path = join(directory, "invitation-signing-key");
	_temporaryDirectories.push(directory);
	writeFileSync(path, Buffer.alloc(32, 7).toString("base64url"));
	return path;
}

describe("opencrane process config", function _ProcessConfigSuite()
{
	beforeEach(function _stubRequiredMemoryGatewayEnvironment()
	{
		vi.stubEnv("DATABASE_URL", "postgresql://opencrane:test@localhost:5432/opencrane");
		vi.stubEnv("CONVERSATION_PRIVATE_PAYLOAD_KEYRING_PATH", "/var/run/opencrane/conversation-payload/keyring.json");
		vi.stubEnv("MEMORY_GATEWAY_URL", "http://opencrane-memory-gateway.default.svc.cluster.local:8080");
		vi.stubEnv("MEMORY_GATEWAY_TOKEN_PATH", "/var/run/opencrane/memory-gateway/token");
		vi.stubEnv("OPENCRANE_HISTORY_STORE_ENDPOINT", "opencrane-kurrentdb.default.svc:2113");
		vi.stubEnv("OPENCRANE_HISTORY_STORE_CA_CERTIFICATE_PATH", "/var/run/opencrane/history-store/ca.crt");
		vi.stubEnv("OPENCRANE_HISTORY_STORE_USERNAME_PATH", "/var/run/opencrane/history-store/username");
		vi.stubEnv("OPENCRANE_HISTORY_STORE_PASSWORD_PATH", "/var/run/opencrane/history-store/password");
		vi.stubEnv("OPENCRANE_OCI_REGISTRY_BASE_URL", "https://registry.example.test");
		vi.stubEnv("OPENCRANE_OCI_REGISTRY_REPOSITORY", "opencrane/mcp-images");
		vi.stubEnv("OPENCRANE_SILO_ID", "silo-test");
		vi.stubEnv("MCP_EXECUTOR_NAMESPACE", "mcp-executors");
		vi.stubEnv("SKILL_AUTHORING_NAMESPACE", "skill-authoring");
	});

	afterEach(function _restoreEnvironment()
	{
		vi.unstubAllEnvs();
		for (const directory of _temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
	});

	it("reads one shared snapshot for listeners and background workers", function _ReadSnapshot()
	{
		vi.stubEnv("PORT", "9080");
		vi.stubEnv("INTERNAL_PORT", "9081");
		vi.stubEnv("WATCH_NAMESPACE", "workspace-seeds");
		vi.stubEnv("ARTIFACT_SCANNER_ENABLED", "true");
		vi.stubEnv("ARTIFACT_SCANNER_CLAIM_LEASE_SECONDS", "240");
		vi.stubEnv("ARTIFACT_SCANNER_NAMESPACE", "artifact-scanner");
		vi.stubEnv("MCP_CONTROLLER_CLAIM_LEASE_SECONDS", "20");
		vi.stubEnv("MCP_COMPANION_CLAIM_LEASE_SECONDS", "25");

			expect(_ReadProcessConfig()).toMatchObject({
				authWatchNamespace: "workspace-seeds",
				conversationPrivatePayloadKeyringPath: "/var/run/opencrane/conversation-payload/keyring.json",
			historyStore: {
				caCertificatePath: "/var/run/opencrane/history-store/ca.crt",
				endpoint: "opencrane-kurrentdb.default.svc:2113",
				passwordPath: "/var/run/opencrane/history-store/password",
				usernamePath: "/var/run/opencrane/history-store/username",
			},
			internalPort: 9081,
			publicPort: 9080,
			runtime: {
				artifactScannerEnabled: true,
				artifactScannerClaimLeaseMilliseconds: 240_000,
				artifactScannerNamespace: "artifact-scanner",
				mcpCompanionClaimLeaseMilliseconds: 25_000,
				mcpControllerClaimLeaseMilliseconds: 20_000,
				mcpExecutorNamespace: "mcp-executors",
				memoryGatewayTimeoutMilliseconds: 30_000,
				memoryGatewayTokenPath: "/var/run/opencrane/memory-gateway/token",
				memoryGatewayUrl: "http://opencrane-memory-gateway.default.svc.cluster.local:8080",
				skillAuthoringNamespace: "skill-authoring",
				siloId: "silo-test",
			},
			workflows: {
				databasePoolSize: 2,
				databaseUrl: "postgresql://opencrane:test@localhost:5432/opencrane",
				mcpEraProbeMaximumResponseBytes: 65_536,
				mcpEraProbeTimeoutMilliseconds: 5_000,
				ociRegistryBaseUrl: "https://registry.example.test",
				ociRegistryRepository: "opencrane/mcp-images",
				ociRegistryTimeoutMilliseconds: 30_000,
				pollIntervalMilliseconds: 100,
				siloId: "silo-test",
				workerConcurrency: 2,
			},
		});
	});

	it("reads the release-owned conversation-computer profile", function _ReadComputerProfile()
	{
		vi.stubEnv("OPENCRANE_COMPUTER_PROFILE_REVISION_ID", `sha256:${"a".repeat(64)}`);
		vi.stubEnv("OPENCRANE_COMPUTER_PROFILE_NAME", "developer");
		vi.stubEnv("OPENCRANE_COMPUTER_WARM_POOL_NAME", "developer-pool");
		vi.stubEnv("OPENCRANE_COMPUTER_NAMESPACE", "opencrane-testv5");
		vi.stubEnv("OPENCRANE_COMPUTER_SERVICE_ACCOUNT_NAME", "opencrane-conversation-computer");
		vi.stubEnv("OPENCRANE_COMPUTER_MAX_TURN_COST_USD_MICROS", "100000");
		vi.stubEnv("OPENCRANE_COMPUTER_LEASE_TTL_SECONDS", "1800");
		expect(_ReadAgentSandboxReleaseProfileConfig()).toEqual({ profileRevisionId: `sha256:${"a".repeat(64)}`, profileName: "developer", warmPoolName: "developer-pool", namespace: "opencrane-testv5", serviceAccountName: "opencrane-conversation-computer", leaseTtlMilliseconds: 1_800_000, maximumTurnCostUsdMicros: 100_000 });
	});

	it("reads bounded run-admission capacity from the existing chart settings", function _ReadRunAdmissionCapacity()
	{
		vi.stubEnv("AGENT_RUN_ADMISSION_MAX_CONCURRENT", "7");
		vi.stubEnv("AGENT_RUN_ADMISSION_MAX_QUEUED", "23");

		expect(_ReadProcessConfig().runAdmission).toEqual({ maxConcurrentAdmissions: 7, maxQueuedAdmissions: 23 });

		vi.stubEnv("AGENT_RUN_ADMISSION_MAX_QUEUED", "1001");
		expect(function _ReadExcessiveRunAdmissionQueue() { _ReadProcessConfig(); }).toThrow(/integer from 0 through 1000/);
	});

	it("rejects missing or excessive durable workflow settings", function _RejectInvalidWorkflowConfig()
	{
		vi.stubEnv("OPENCRANE_SILO_ID", "");
		expect(function _readWithoutSilo() { _ReadProcessConfig(); }).toThrow(/OPENCRANE_SILO_ID is required/);

		vi.stubEnv("OPENCRANE_SILO_ID", "silo-test");
		vi.stubEnv("OPENCRANE_WORKFLOW_WORKER_CONCURRENCY", "21");
		expect(function _readExcessiveWorkerConcurrency() { _ReadProcessConfig(); }).toThrow(/integer from 1 through 20/);

		vi.stubEnv("OPENCRANE_WORKFLOW_WORKER_CONCURRENCY", "2");
		vi.stubEnv("OPENCRANE_MCP_ERA_PROBE_TIMEOUT_MS", "999");
		expect(function _readShortProbeTimeout() { _ReadProcessConfig(); }).toThrow(/integer from 1000 through 60000/);

		vi.stubEnv("OPENCRANE_MCP_ERA_PROBE_TIMEOUT_MS", "5000");
		vi.stubEnv("OPENCRANE_OCI_REGISTRY_AUTHORIZATION_FILE", "relative/authorization");
		expect(function _readRelativeRegistryCredential() { _ReadProcessConfig(); }).toThrow(/absolute mounted file path/);
	});

	it("requires a credential-free KurrentDB host, port, and mounted file paths", function _RejectsInvalidHistoryStoreConfig()
	{
		vi.stubEnv("OPENCRANE_HISTORY_STORE_ENDPOINT", "kurrentdb://operator:secret@history.example:2113");
		expect(function _CredentialedHistoryEndpoint() { _ReadProcessConfig(); }).toThrow(/credential-free host:port/);

		vi.stubEnv("OPENCRANE_HISTORY_STORE_ENDPOINT", "history.example");
		expect(function _PortlessHistoryEndpoint() { _ReadProcessConfig(); }).toThrow(/credential-free host:port/);

		vi.stubEnv("OPENCRANE_HISTORY_STORE_ENDPOINT", "history.example:0");
		expect(function _ZeroHistoryEndpointPort() { _ReadProcessConfig(); }).toThrow(/credential-free host:port/);

		vi.stubEnv("OPENCRANE_HISTORY_STORE_ENDPOINT", "history.example:2113");
		vi.stubEnv("OPENCRANE_HISTORY_STORE_CA_CERTIFICATE_PATH", "var/run/history/ca.crt");
		expect(function _RelativeHistoryCertificate() { _ReadProcessConfig(); }).toThrow(/OPENCRANE_HISTORY_STORE_CA_CERTIFICATE_PATH must be an absolute path/);
	});

	it("reads the all-or-nothing standalone first-owner admission contract", function _ReadStandaloneFirstUserAdmission()
	{
		expect(_ReadProcessConfig().standaloneFirstUserAdmission).toBeNull();

		vi.stubEnv("OPENCRANE_MEMBERSHIP_MODE", "standalone");
		vi.stubEnv("OPENCRANE_STANDALONE_FIRST_USER_EMAIL", "JENTE@ELEWA.KE");
		vi.stubEnv("OPENCRANE_STANDALONE_CLUSTER_TENANT", "testv2");
		vi.stubEnv("OIDC_ISSUER_URL", "https://issuer.example");
		expect(_ReadProcessConfig().standaloneFirstUserAdmission).toEqual({ email: "jente@elewa.ke", clusterTenant: "testv2", issuer: "https://issuer.example" });
	});

	it("rejects a partial or non-standalone first-owner admission contract", function _RejectInvalidStandaloneFirstUserAdmission()
	{
		vi.stubEnv("OPENCRANE_STANDALONE_FIRST_USER_EMAIL", "jente@elewa.ke");
		expect(function _readPartialStandaloneFirstUserAdmission() { _ReadProcessConfig(); }).toThrow(/configured together/);

		vi.stubEnv("OPENCRANE_STANDALONE_CLUSTER_TENANT", "testv2");
		vi.stubEnv("OPENCRANE_MEMBERSHIP_MODE", "fleet");
		expect(function _readFleetStandaloneFirstUserAdmission() { _ReadProcessConfig(); }).toThrow(/MEMBERSHIP_MODE=standalone/);
	});

	it("reads Fleet membership with a projected-token path", function _ReadFleetMembership()
	{
		vi.stubEnv("OPENCRANE_MEMBERSHIP_MODE", "fleet");
		vi.stubEnv("OPENCRANE_MEMBERSHIP_BILLING_GATEWAY_URL", "https://fleet.example");
		vi.stubEnv("OPENCRANE_MEMBERSHIP_BILLING_GATEWAY_SILO_ID", "silo-a");
		vi.stubEnv("OPENCRANE_MEMBERSHIP_BILLING_GATEWAY_TOKEN_PATH", "/var/run/opencrane/membership-billing/token");
		expect(_ReadOrganizationMembershipConfig()).toMatchObject({ mode: "fleet", fleet: { baseUrl: "https://fleet.example", credentialSiloId: "silo-a", projectedTokenPath: "/var/run/opencrane/membership-billing/token" } });
	});

	it("rejects a plaintext Fleet membership receiver before startup", function _RejectPlaintextFleetMembership()
	{
		vi.stubEnv("OPENCRANE_MEMBERSHIP_MODE", "fleet");
		vi.stubEnv("OPENCRANE_MEMBERSHIP_BILLING_GATEWAY_URL", "http://fleet.example");
		expect(function _ReadPlaintextFleetMembership() { _ReadOrganizationMembershipConfig(); }).toThrow(/HTTPS origin/);
	});

	it("accepts only a credential-free HTTPS public invitation origin", function _ValidatePublicInvitationOrigin()
	{
		vi.stubEnv("OPENCRANE_MEMBERSHIP_MODE", "standalone");
		vi.stubEnv("OPENCRANE_INVITATION_SIGNING_KEY_PATH", _createInvitationSigningKey());

		vi.stubEnv("OPENCRANE_PUBLIC_BASE_URL", "https://opencrane.example");
		expect(_ReadOrganizationMembershipConfig()).toMatchObject({ standalone: { publicBaseUrl: "https://opencrane.example" } });

		vi.stubEnv("OPENCRANE_PUBLIC_BASE_URL", "http://localhost:4200");
		expect(function _ReadPlaintextPublicOrigin() { _ReadOrganizationMembershipConfig(); }).toThrow(/HTTPS origin/);

		vi.stubEnv("OPENCRANE_PUBLIC_BASE_URL", "https://operator:secret@opencrane.example");
		expect(function _ReadCredentialedPublicOrigin() { _ReadOrganizationMembershipConfig(); }).toThrow(/credential-free HTTPS origin/);

		vi.stubEnv("OPENCRANE_PUBLIC_BASE_URL", "https://opencrane.example/settings");
		expect(function _ReadPublicOriginWithPath() { _ReadOrganizationMembershipConfig(); }).toThrow(/credential-free HTTPS origin/);
	});

	it("rejects an artifact output ceiling outside the broker boundary", function _RejectInvalidBodyLimit()
	{
		vi.stubEnv("ARTIFACT_PREPROCESSOR_MAX_OUTPUT_BYTES", "67108865");
		expect(function _readInvalidConfig() { _ReadProcessConfig(); }).toThrow(/integer from 1024 through 67108864/);
	});

	it("fails boot when the memory-gateway origin or token path is missing", function _RejectMissingMemoryGateway()
	{
		vi.stubEnv("MEMORY_GATEWAY_URL", "");
		expect(function _readWithoutGatewayUrl() { _ReadProcessConfig(); }).toThrow(/MEMORY_GATEWAY_URL is required/);

		vi.stubEnv("MEMORY_GATEWAY_URL", "http://opencrane-memory-gateway.default.svc.cluster.local:8080");
		vi.stubEnv("MEMORY_GATEWAY_TOKEN_PATH", "");
		expect(function _readWithoutTokenPath() { _ReadProcessConfig(); }).toThrow(/MEMORY_GATEWAY_TOKEN_PATH is required/);
	});

	it("rejects a relative memory-gateway token path and an out-of-bounds timeout", function _RejectInvalidMemoryGatewaySettings()
	{
		vi.stubEnv("MEMORY_GATEWAY_TOKEN_PATH", "var/run/token");
		expect(function _readRelativeTokenPath() { _ReadProcessConfig(); }).toThrow(/MEMORY_GATEWAY_TOKEN_PATH must be an absolute path/);

		vi.stubEnv("MEMORY_GATEWAY_TOKEN_PATH", "/var/run/opencrane/memory-gateway/token");
		vi.stubEnv("MEMORY_GATEWAY_TIMEOUT_SECONDS", "301");
		expect(function _readExcessiveTimeout() { _ReadProcessConfig(); }).toThrow(/integer from 1 through 300/);
	});

});
