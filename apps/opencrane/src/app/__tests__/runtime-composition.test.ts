import type { PrismaClient } from "@prisma/client";
import type { AuthenticationV1Api } from "@kubernetes/client-node";
import { afterEach, describe, expect, it, vi } from "vitest";

import { _CreateInternalRuntimeComposition } from "../runtime-composition.js";
import type { InternalRuntimeConfig } from "../config.types.js";

/**
 * Replace the artifact-service bridges because this composition test proves only the router-plane
 * decision; broker tests own endpoint and mounted-key validation.
 */
vi.mock("../../infra/artifacts/artifact-upload.factory.js", function _MockArtifactUploadFactory()
{
	return {
		_CreateArtifactPreprocessOutputBroker: function _CreateArtifactPreprocessOutputBroker() { return {}; },
		_CreateConversationAssetOutputAuthority: function _CreateConversationAssetOutputAuthority() { return { reserve: vi.fn(), publish: vi.fn() }; },
		_CreateSkillAuthoringArtifactReader: function _CreateSkillAuthoringArtifactReader() { return {}; },
	};
});

vi.mock("../../infra/artifacts/artifact-preprocess-source-broker.factory.js", function _MockArtifactSourceBrokerFactory()
{
	return {
		_CreateArtifactPreprocessSourceBroker: function _CreateArtifactPreprocessSourceBroker() { return {}; },
	};
});

vi.mock("../../infra/artifacts/artifact-scan-source-broker.factory.js", function _MockArtifactScanSourceBrokerFactory()
{
	return {
		_CreateArtifactScanSourceBroker: function _CreateArtifactScanSourceBroker() { return {}; },
	};
});

/** Build the smallest valid workload-facing configuration used by composition tests. */
function _RuntimeConfig(): InternalRuntimeConfig
{
	return {
		artifactScannerEnabled: false,
		artifactScannerClaimLeaseMilliseconds: 300_000,
		artifactScannerNamespace: undefined,
		artifactPreprocessorEnabled: false,
		artifactPreprocessorMaximumOutputBytes: 1_024,
		artifactPreprocessorNamespace: undefined,
		assignmentTtlMilliseconds: 60_000,
		channelTargets: null,
		claimLeaseMilliseconds: 30_000,
		commandRecoveryMilliseconds: 15_000,
		commandTtlMilliseconds: 60_000,
		managedRuntimeNamespace: "managed-runtime",
		memoryGatewayTimeoutMilliseconds: 30_000,
		memoryGatewayTokenPath: "/var/run/opencrane/memory-gateway/token",
		memoryGatewayUrl: "http://opencrane-memory-gateway.default.svc.cluster.local:8080",
		outboxPruneBatchSize: 100,
		personalRuntimeNamespace: "personal-runtime",
		publishedOutboxRetentionMilliseconds: 86_400_000,
		serverNamespace: "opencrane-server",
	};
}

describe("_CreateInternalRuntimeComposition", function _internalRuntimeCompositionSuite()
{
	afterEach(function _RestoreEnvironment()
	{
		vi.unstubAllEnvs();
	});

	it("keeps disabled optional planes unmounted while composing every mandatory caller plane", function _composesRequiredPlanes()
	{
		const composition = _CreateInternalRuntimeComposition({} as PrismaClient, {} as AuthenticationV1Api, _RuntimeConfig());

		expect(composition.agentControllerRunDispatch).toEqual(expect.any(Function));
		expect(composition.skillWorkloadDispatch).toEqual(expect.any(Function));
		expect(composition.skillWorkloadBootstrap).toEqual(expect.any(Function));
		expect(composition.skillAuthoringInput).toEqual(expect.any(Function));
		expect(composition.skillAuthoringCompletion).toEqual(expect.any(Function));
		expect(composition.runtimeBootstrap).toEqual(expect.any(Function));
		expect(composition.runtimeStream).toEqual(expect.any(Function));
		expect(composition.conversationAssetOutputs).toEqual(expect.any(Function));
		expect(composition.agentThreadParentDeliveries).toEqual(expect.any(Function));
		expect(composition.artifactPreprocessor).toBeNull();
		expect(composition.artifactScanner).toBeNull();
		expect(composition.channelTargetResolver).toBeNull();
		expect(composition.conversationReplay).toBeNull();
	});

	it("refuses an enabled worker plane that crosses into the trusted server namespace", function _rejectsCrossedWorkerPlane()
	{
		const config = { ..._RuntimeConfig(), artifactPreprocessorEnabled: true, artifactPreprocessorNamespace: "opencrane-server" };

		expect(function _composeCrossedWorkerPlane() { _CreateInternalRuntimeComposition({} as PrismaClient, {} as AuthenticationV1Api, config); }).toThrow(/different from POD_NAMESPACE/);
	});

	it("refuses an enabled scanner plane that crosses into the trusted server namespace", function _rejectsCrossedScannerPlane()
	{
		const config = { ..._RuntimeConfig(), artifactScannerEnabled: true, artifactScannerNamespace: "opencrane-server" };

		expect(function _composeCrossedScannerPlane() { _CreateInternalRuntimeComposition({} as PrismaClient, {} as AuthenticationV1Api, config); }).toThrow(/different from POD_NAMESPACE/);
	});

	it("composes both optional planes only after their concrete boundaries are configured", function _composesOptionalPlanes()
	{
		vi.stubEnv("OPENCRANE_MEMBERSHIP_MODE", "standalone");
		vi.stubEnv("OPENCRANE_MEMBERSHIP_MAX_STALENESS_MS", "86400000");
		const config = {
			..._RuntimeConfig(),
			artifactPreprocessorEnabled: true,
			artifactPreprocessorNamespace: "artifact-preprocessor",
			artifactScannerEnabled: true,
			artifactScannerNamespace: "artifact-scanner",
			channelTargets: { channelProxyServiceAccountName: "channel-proxy", invocationContextTtlMilliseconds: 60_000, receiverEndpoint: "http://opencrane-server.opencrane-server.svc.cluster.local:8081/api/internal/conversation-replay", receiverId: "internal-channel-replay", siloId: "silo-1", trustedHost: "acme.example.com" },
		};

		const composition = _CreateInternalRuntimeComposition({} as PrismaClient, {} as AuthenticationV1Api, config);

		expect(composition.artifactPreprocessor).toEqual(expect.any(Function));
		expect(composition.artifactScanner).toEqual(expect.any(Function));
		expect(composition.channelTargetResolver).toEqual(expect.any(Function));
		expect(composition.conversationReplay).toEqual(expect.any(Function));
	});

	it("refuses an enabled scanner plane without a separate namespace", function _rejectsScannerWithoutNamespace()
	{
		const config = { ..._RuntimeConfig(), artifactScannerEnabled: true, artifactScannerNamespace: undefined };

		expect(function _composeScannerWithoutNamespace() { _CreateInternalRuntimeComposition({} as PrismaClient, {} as AuthenticationV1Api, config); }).toThrow(/restricted workload namespace must be valid/);
	});

	it("refuses an enabled worker plane without a separate namespace", function _rejectsWorkerWithoutNamespace()
	{
		const config = { ..._RuntimeConfig(), artifactPreprocessorEnabled: true, artifactPreprocessorNamespace: undefined };

		expect(function _composeWorkerWithoutNamespace() { _CreateInternalRuntimeComposition({} as PrismaClient, {} as AuthenticationV1Api, config); }).toThrow(/restricted workload namespace must be valid/);
	});

	it("refuses runtime planes that collapse into one identity namespace", function _rejectsCollapsedRuntimePlanes()
	{
		const config = { ..._RuntimeConfig(), managedRuntimeNamespace: "personal-runtime" };

		expect(function _composeCollapsedRuntimePlanes() { _CreateInternalRuntimeComposition({} as PrismaClient, {} as AuthenticationV1Api, config); }).toThrow(/different from/);
	});
});
