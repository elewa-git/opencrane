import { AgentRevisionState, ArtifactRevisionState, IntegrationCustodyState, IntegrationState, ModelRoutingScope, SkillRevisionState, SkillState } from "@prisma/client";
import type { RunAdmissionTransaction } from "@opencrane/backend/agents/execution/runs";
import { describe, expect, it, vi } from "vitest";

import { PrismaRevisionBudgetPolicySource, PrismaRevisionToolPolicySource } from "../prisma-revision-tool-policy-source.js";

/** Fixed active managed revision facts shared by policy-source tests. */
const _RUN = { agentServiceId: "service-1", agentRevisionId: "revision-1", agentKind: "managed", effectiveContractDigest: `sha256:${"a".repeat(64)}`, promptCompilerVersion: "opencrane.prompt-compiler/2026-07-21.1", trigger: "managed_invocation", delegatedUserId: null, rootRunId: "run-1", parentRunId: null } as const;
/** Fixed assembly coordinates used by policy-source tests. */
const _COMMAND = { runId: "run-1", siloId: "silo-1", agentServiceId: "service-1", threadId: null, executionSubjectId: "agent-service:service-1", requestIdempotencyKey: "request-1" };

/** Builds a Prisma transaction fake around supplied revision and dependent authority rows. */
function _transaction(revision: unknown, skills: unknown[] = [], artifacts: unknown[] = []): RunAdmissionTransaction
{
	return { prisma: { agentRevision: { findFirst: vi.fn().mockResolvedValue(revision) }, skillRevision: { findMany: vi.fn().mockResolvedValue(skills) }, artifactRevision: { findMany: vi.fn().mockResolvedValue(artifacts) } } as never, admittedAt: "2026-07-25T00:00:00.000Z", admittedAtEpochMs: Date.parse("2026-07-25T00:00:00.000Z") };
}

/** Builds a current revision with one live integration and one published skill artifact. */
function _revision(overrides: Record<string, unknown> = {})
{
	return { modelDefinition: { id: "model-definition-1", scope: ModelRoutingScope.ClusterTenant, clusterTenant: "silo-1", publicModelName: "tenant-model", litellmModelId: "litellm-deployment-1" }, integrationAssignments: [{ integrationId: "integration-1", siloId: "silo-1", allowedTools: ["calendar.read"], integration: { state: IntegrationState.Active }, custodyReference: { state: IntegrationCustodyState.Ready, expiresAt: new Date("2026-07-26T00:00:00.000Z") } }], skillAssignments: [{ skillRevisionId: "skill-revision-1" }], budget: { maxTurns: 4, maxTokens: 1024, maxDurationMs: 60_000 }, ...overrides };
}

/** Builds one published skill revision that still belongs to an active silo-owned skill. */
function _skill(overrides: Record<string, unknown> = {})
{
	return { id: "skill-revision-1", artifactRevisionId: "artifact-revision-1", state: SkillRevisionState.Published, skill: { state: SkillState.Active, siloId: "silo-1" }, ...overrides };
}

describe("PrismaRevisionToolPolicySource", function _suite()
{
	it("freezes only live revision-owned model, integration, skill, and artifact references", async function _loads()
	{
		const result = await new PrismaRevisionToolPolicySource().load(_COMMAND, _RUN, _transaction(_revision(), [_skill()], [{ id: "artifact-revision-1", state: ArtifactRevisionState.Published }]));
		expect(result).toEqual({ outcome: "loaded", value: { modelRoute: { alias: "tenant-model", modelDefinitionId: "model-definition-1", litellmModelId: "litellm-deployment-1" }, integrationAssignments: [{ integrationId: "integration-1", allowedTools: ["calendar.read"] }], skillRevisionIds: ["skill-revision-1"], artifactRevisionIds: ["artifact-revision-1"] } });
	});

	it("refuses expired custody and unpublished skills before snapshot assembly", async function _refuses()
	{
		const expired = _revision({ integrationAssignments: [{ integrationId: "integration-1", siloId: "silo-1", allowedTools: ["calendar.read"], integration: { state: IntegrationState.Active }, custodyReference: { state: IntegrationCustodyState.Ready, expiresAt: new Date("2026-07-24T00:00:00.000Z") } }] });
		await expect(new PrismaRevisionToolPolicySource().load(_COMMAND, _RUN, _transaction(expired))).resolves.toEqual({ outcome: "denied", reason: "tool_policy_unavailable" });
		await expect(new PrismaRevisionToolPolicySource().load(_COMMAND, _RUN, _transaction(_revision(), [_skill({ state: SkillRevisionState.Draft })], [{ id: "artifact-revision-1" }]))).resolves.toEqual({ outcome: "denied", reason: "tool_policy_unavailable" });
	});

	it("denies a live integration projected from another silo", async function _foreignIntegration()
	{
		const foreign = _revision({ integrationAssignments: [{ integrationId: "integration-1", siloId: "silo-other", allowedTools: ["calendar.read"], integration: { state: IntegrationState.Active }, custodyReference: { state: IntegrationCustodyState.Ready, expiresAt: new Date("2026-07-26T00:00:00.000Z") } }] });
		await expect(new PrismaRevisionToolPolicySource().load(_COMMAND, _RUN, _transaction(foreign))).resolves.toEqual({ outcome: "denied", reason: "tool_policy_unavailable" });
	});

	it("deduplicates a shared artifact revision assigned through two published skills", async function _sharedArtifact()
	{
		const revision = _revision({ skillAssignments: [{ skillRevisionId: "skill-revision-1" }, { skillRevisionId: "skill-revision-2" }] });
		const secondSkill = _skill({ id: "skill-revision-2" });
		const result = await new PrismaRevisionToolPolicySource().load(_COMMAND, _RUN, _transaction(revision, [_skill(), secondSkill], [{ id: "artifact-revision-1" }]));
		if (result.outcome !== "loaded") throw new Error("expected live shared artifact");
		expect(result.value.artifactRevisionIds).toEqual(["artifact-revision-1"]);
	});
});

describe("PrismaRevisionBudgetPolicySource", function _suite()
{
	it("converts immutable positive revision limits into a deadline-bound compiler policy", async function _loads()
	{
		const result = await new PrismaRevisionBudgetPolicySource().load(_COMMAND, _RUN, _transaction(_revision()));
		expect(result).toEqual({ outcome: "loaded", value: { budgetPolicy: { maxModelTurns: 4, maxTotalTokens: 1024, wallClockDeadlineEpochMs: Date.parse("2026-07-25T00:01:00.000Z") } } });
	});

	it("refuses a malformed revision budget", async function _refuses()
	{
		await expect(new PrismaRevisionBudgetPolicySource().load(_COMMAND, _RUN, _transaction(_revision({ budget: { maxTurns: 0, maxTokens: 1024, maxDurationMs: 60_000 } })))).resolves.toEqual({ outcome: "denied", reason: "budget_unavailable" });
	});

	it("refuses a duration whose deadline overflows the safe integer range", async function _overflow()
	{
		await expect(new PrismaRevisionBudgetPolicySource().load(_COMMAND, _RUN, _transaction(_revision({ budget: { maxTurns: 4, maxTokens: 1024, maxDurationMs: Number.MAX_SAFE_INTEGER } })))).resolves.toEqual({ outcome: "denied", reason: "budget_unavailable" });
	});
});
