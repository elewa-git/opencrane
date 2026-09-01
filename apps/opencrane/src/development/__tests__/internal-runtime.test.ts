import { describe, expect, it, vi } from "vitest";

import type { RuntimeExternalActionAuthorizationService } from "@opencrane/backend/agents/execution/protocol";
import { AGENT_RUNTIME_PROTOCOL_VERSION, RunInputSnapshotIdentityKinds, RuntimeCandidateKinds, type RuntimeExternalActionCandidate } from "@opencrane/contracts";
import { LocalDevelopmentProfileKinds } from "@opencrane/models/local-development";
import { AuthorizationDecisionOutcomes } from "@opencrane/models/authorization";
import { ___DigestCanonicalJson } from "@opencrane/util";

import { _CreateDevelopmentInternalRuntimeComposition } from "../internal-runtime";

/** Captures the authorization service and membership evidence passed through mocked factories. */
const _captured = vi.hoisted(function _Captured()
{
	return {
		authorization: null as RuntimeExternalActionAuthorizationService | null,
		membershipEvidence: null as unknown,
	};
});

vi.mock("@opencrane/backend/agents/execution/protocol", async function _MockProtocol(importOriginal)
{
	const actual = await importOriginal<typeof import("@opencrane/backend/agents/execution/protocol")>();
	return {
		...actual,
		PrismaRuntimeContinuationAuthorityUnitOfWork: class {},
		__CreateProductionRuntimeDispatchAuthority: vi.fn(function _Capture(_prisma, _config, _continuation, authorization: RuntimeExternalActionAuthorizationService)
		{
			_captured.authorization = authorization;
			return {};
		}),
	};
});

vi.mock("@opencrane/backend/server/iam/authorization", async function _MockAuthorization(importOriginal)
{
	const actual = await importOriginal<typeof import("@opencrane/backend/server/iam/authorization")>();
	return {
		...actual,
		PrismaAuthorizationAuthority: class
		{
			async admitPrincipalBatch(commands: readonly unknown[]): Promise<readonly unknown[]>
			{
				return commands.map(function _Allow()
				{
					return { outcome: AuthorizationDecisionOutcomes.Allow, evidence: { decisionDigest: `sha256:${"b".repeat(64)}` } };
				});
			}
		},
	};
});

vi.mock("@opencrane/backend/server/iam/membership", function _MockMembership()
{
	return {
		PrismaRuntimeMembershipEligibilityAuthority: class
		{
			constructor(_transaction: unknown, evidence: unknown)
			{
				_captured.membershipEvidence = evidence;
			}

			async isEligible(): Promise<boolean> { return true; }
		},
	};
});

vi.mock("@opencrane/backend/server/agents/agent-services", function _MockAgentServices()
{
	return { PrismaRuntimeAgentEffectEligibilityAuthority: class { async isEligible(): Promise<boolean> { return true; } } };
});

vi.mock("@opencrane/backend/server/gateways/mcp", function _MockMcp()
{
	return { PrismaRuntimeMcpEffectEligibilityAuthority: class { async isEligible(): Promise<boolean> { return true; } } };
});

vi.mock("@opencrane/backend/agents/personal/memory", function _MockMemory()
{
	return { PrismaRuntimePersonalMemoryEffectEligibilityAuthority: class { async isEligible(): Promise<boolean> { return true; } } };
});

vi.mock("@opencrane/backend/agents/personal/personas", function _MockPersonas()
{
	return { PrismaRuntimePersonaEffectEligibilityAuthority: class { async findEligibleProfileId(): Promise<string> { return "persona-profile-1"; } } };
});

vi.mock("@opencrane/backend/agents/execution/runs", function _MockRuns()
{
	return {
		PrismaAgentRunWarmRuntimeUnitOfWork: class {},
		PrismaWarmRuntimeBindingUnitOfWork: class {},
		__CreateAgentRunWorkflowControllerRouter: vi.fn(function _Router() { return {}; }),
		__CreateWarmRuntimeBindingRouter: vi.fn(function _Router() { return {}; }),
	};
});

vi.mock("@opencrane/backend/server/conversations", function _MockConversations()
{
	return {
		PrismaAgentThreadParentDeliveryUnitOfWork: class {},
		__CreateAgentThreadParentDeliveryRouter: vi.fn(function _Router() { return {}; }),
	};
});

vi.mock("@opencrane/backend/server/infra/agent-runtime-continuation", function _MockContinuation()
{
	return { MountedRuntimeContinuationCipher: class {} };
});

vi.mock("@opencrane/backend/server/infra/agent-runtime-stream", function _MockStream()
{
	return { _RegisterInternalAgentRuntimeStream: vi.fn(function _Router() { return {}; }) };
});

/** Builds admitted run context whose identity snapshot supplies the membership re-check fields. */
function _Context()
{
	return {
		runId: "run-1", attempt: 1, agentServiceId: "service-1", agentRevisionId: "revision-1", siloId: "silo-1", runState: "Running", terminalReason: null,
		assignmentDigest: `sha256:${"a".repeat(64)}`, inputSnapshotDigest: "sha256:snapshot", conversationId: "conversation-1", personaRevisionId: "persona-revision-1",
		identity: { kind: RunInputSnapshotIdentityKinds.User, executionSubjectId: "user-1", fleetMembershipRevision: 7 }, capabilitySetDigest: "sha256:capabilities",
		serviceAccountName: "runtime", workloadKind: "Deployment", podUid: "pod-1", leaseExpiresAtEpochMs: Date.parse("2026-08-29T01:00:00.000Z"), assignmentIssuedAt: "2026-08-29T00:00:00.000Z", assignmentExpiresAt: "2026-08-29T01:00:00.000Z",
		snapshot: {
			runId: "run-1", siloId: "silo-1", agentServiceId: "service-1", agentRevisionId: "revision-1", snapshotVersion: 1,
			conversationId: "conversation-1", messageIds: [], personaRevisionId: "persona-revision-1", preferenceFactIds: [], artifactRevisionIds: [], skillRevisionIds: [],
			memoryQueryPolicy: null, mcpTools: [], modelRoute: {}, budgetPolicy: {},
			identitySnapshot: { kind: RunInputSnapshotIdentityKinds.User, executionIssuer: "issuer", executionSubjectId: "user-1", principalId: "principal-1", fleetMembershipRevision: 7, fleetMembershipIssuer: "fleet", fleetMembershipIssuerKeyId: "key-1", fleetMembershipAssertionId: "assertion-1", fleetMembershipPayloadDigest: "sha256:membership", fleetMembershipTrustedUntil: "2026-08-30T00:00:00.000Z" },
			capabilitySetDigest: "sha256:capabilities", effectiveContractDigest: "sha256:contract", promptCompilerVersion: "v1", digest: "sha256:snapshot", compiledAt: "2026-08-29T00:00:00.000Z",
		},
	};
}

/** Builds an external action so the test invokes transaction-bound membership eligibility. */
function _Candidate(): RuntimeExternalActionCandidate
{
	const argumentsValue = { query: "approved input" };
	return { protocolVersion: AGENT_RUNTIME_PROTOCOL_VERSION, runtimeInstanceId: "runtime-1", commandId: "command-1", candidateId: "candidate-1", runId: "run-1", attempt: 1, fence: 1, kind: RuntimeCandidateKinds.ExternalAction, toolRevisionId: "mcp-tool-1", toolInvocationId: "invocation-1", arguments: argumentsValue, argumentsDigest: ___DigestCanonicalJson(argumentsValue) };
}

describe("Tier 2 internal runtime composition", function _Describe()
{
	it("reuses the validated development membership evidence for runtime actions", async function _UsesInjectedEvidence()
	{
		const membershipEvidence = { trustedIssuerId: "development", maximumStalenessMs: 60_000, verifier: { verify: vi.fn() } };
		_CreateDevelopmentInternalRuntimeComposition(
			{} as never,
			{ assignmentTtlMilliseconds: 60_000, commandTtlMilliseconds: 60_000, commandRecoveryMilliseconds: 1_000 } as never,
			{ serverNamespace: "server", personalRuntimeNamespace: "personal", managedRuntimeNamespace: "managed" } as never,
			LocalDevelopmentProfileKinds.AgentSimulated,
			{} as never,
			{} as never,
			"/tmp/continuation-keyring",
			membershipEvidence,
		);

		await expect(_captured.authorization?.admitInTransaction({} as never, _Context() as never, _Candidate(), new Date("2026-08-29T00:01:00.000Z"))).resolves.not.toBeNull();
		expect(_captured.membershipEvidence).toBe(membershipEvidence);
	});
});
