import type { PrismaClient } from "@prisma/client";
import type { AuthenticationV1Api } from "@kubernetes/client-node";
import { describe, expect, it } from "vitest";

import { _CreateInternalRuntimeComposition } from "../runtime-composition.js";
import type { InternalRuntimeConfig } from "../config.types.js";

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
});
