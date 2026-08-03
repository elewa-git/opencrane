import type { PrismaClient } from "@prisma/client";
import type { AuthenticationV1Api } from "@kubernetes/client-node";
import { describe, expect, it, vi } from "vitest";

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
		_CreateArtifactPreprocessSourceBroker: function _CreateArtifactPreprocessSourceBroker() { return {}; },
		_CreateSkillAuthoringArtifactReader: function _CreateSkillAuthoringArtifactReader() { return {}; },
	};
});

/** Build the smallest valid workload-facing configuration used by composition tests. */
function _RuntimeConfig(): InternalRuntimeConfig
{
	return {
		artifactPreprocessorEnabled: false,
		artifactPreprocessorMaximumOutputBytes: 1_024,
		artifactPreprocessorNamespace: undefined,
		assignmentTtlMilliseconds: 60_000,
		channelReplayRouteId: null,
		claimLeaseMilliseconds: 30_000,
		commandRecoveryMilliseconds: 15_000,
		commandTtlMilliseconds: 60_000,
		managedRuntimeNamespace: "managed-runtime",
		outboxPruneBatchSize: 100,
		personalRuntimeNamespace: "personal-runtime",
		publishedOutboxRetentionMilliseconds: 86_400_000,
		serverNamespace: "opencrane-server",
	};
}

describe("_CreateInternalRuntimeComposition", function _internalRuntimeCompositionSuite()
{
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
		expect(composition.artifactPreprocessor).toBeNull();
		expect(composition.conversationReplay).toBeNull();
	});

	it("refuses an enabled worker plane that crosses into the trusted server namespace", function _rejectsCrossedWorkerPlane()
	{
		const config = { ..._RuntimeConfig(), artifactPreprocessorEnabled: true, artifactPreprocessorNamespace: "opencrane-server" };

		expect(function _composeCrossedWorkerPlane() { _CreateInternalRuntimeComposition({} as PrismaClient, {} as AuthenticationV1Api, config); }).toThrow(/different from POD_NAMESPACE/);
	});

	it("composes both optional planes only after their concrete boundaries are configured", function _composesOptionalPlanes()
	{
		const config = {
			..._RuntimeConfig(),
			artifactPreprocessorEnabled: true,
			artifactPreprocessorNamespace: "artifact-preprocessor",
			channelReplayRouteId: "internal-channel-replay",
		};

		const composition = _CreateInternalRuntimeComposition({} as PrismaClient, {} as AuthenticationV1Api, config);

		expect(composition.artifactPreprocessor).toEqual(expect.any(Function));
		expect(composition.conversationReplay).toEqual(expect.any(Function));
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
