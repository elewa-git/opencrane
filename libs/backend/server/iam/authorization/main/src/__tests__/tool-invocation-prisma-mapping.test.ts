import { ExternalActionRecoveryMode, Prisma, ToolInvocationAuthorizationActorKind, ToolInvocationState } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import { ProductAuthorizationActions, ProductAuthorizationResourceKinds } from "@opencrane/models/authorization";

import { PrismaToolInvocationRepository } from "../prisma-tool-invocation-repository";

/** Builds a complete stored ToolInvocation row around the fields one test changes. */
function _row(overrides: Readonly<Record<string, unknown>> = {}): Prisma.ToolInvocationGetPayload<Record<string, never>>
{
	const row = {
		id: "invocation-1", siloId: "silo-1", runId: "run-1", attempt: 2, mcpTaskId: null, agentServiceId: "service-1", agentRevisionId: "revision-1", subjectId: "principal-1",
		authorizationPrincipalId: "principal-1", authorizationActorKind: ToolInvocationAuthorizationActorKind.User,
		authorizationCoordinates: [{ resource: { kind: ProductAuthorizationResourceKinds.McpToolRevision, id: "tool-revision-1" }, action: ProductAuthorizationActions.Invoke }],
		authorizationDecisionDigests: [`sha256:${"b".repeat(64)}`], authorizationMembershipRevision: 3,
		authorizationAssignmentDigest: `sha256:${"a".repeat(64)}`, authorizationEvidenceDigest: `sha256:${"c".repeat(64)}`,
		runtimeInstanceId: "runtime-1", commandId: "command-1", candidateId: "candidate-1", toolRevisionId: "tool-revision-1", toolInvocationId: "tool-1",
		arguments: { title: "Proposed" }, argumentsDigest: "sha256:arguments", effectiveArguments: { title: "Proposed" }, effectiveArgumentsDigest: "sha256:arguments", requestFingerprint: "sha256:fingerprint", requestIdentity: {}, approvalRequired: false,
		recoveryMode: ExternalActionRecoveryMode.Manual, recoveryKey: null, state: ToolInvocationState.Preparing, preparationAttempt: 0,
		retryDeadlineAt: new Date("2026-08-29T10:05:00.000Z"), nextPreparationAttemptAt: new Date("2026-08-29T10:00:00.000Z"), claimAttempt: 0,
		claimKind: null, claimFence: 0, claimExpiresAt: null, recoveryRequiredAt: null, result: null, failureCode: null, revision: 0,
		createdAt: new Date("2026-08-29T10:00:00.000Z"), updatedAt: new Date("2026-08-29T10:00:00.000Z"), completedAt: null,
		...overrides,
	};
	return row as unknown as Prisma.ToolInvocationGetPayload<Record<string, never>>;
}

describe("ToolInvocation Prisma mapping", function _suite()
{
	it("returns the complete central authorization evidence stored with a run-owned invocation", async function _mapsEvidence()
	{
		const transaction = { toolInvocation: { findUnique: vi.fn().mockResolvedValue(_row()) } } as unknown as Prisma.TransactionClient;
		const repository = new PrismaToolInvocationRepository(transaction);
		const record = await repository.findById("invocation-1");

		expect(record).toEqual(expect.objectContaining({ authorizationEvidence: {
			principalId: "principal-1",
			actorKind: "user",
			coordinates: [{ resource: { kind: ProductAuthorizationResourceKinds.McpToolRevision, id: "tool-revision-1" }, action: ProductAuthorizationActions.Invoke }],
			decisionDigests: [`sha256:${"b".repeat(64)}`],
			membershipRevision: 3,
			assignmentDigest: `sha256:${"a".repeat(64)}`,
			evidenceDigest: `sha256:${"c".repeat(64)}`,
		} }));
	});

	it("returns task authorization evidence without inventing AgentRun fields", async function _mapsTaskEvidence()
	{
		const row = _row({
			runId: null,
			attempt: null,
			mcpTaskId: "mcp-task-1",
			agentServiceId: null,
			agentRevisionId: null,
			authorizationMembershipRevision: null,
			authorizationAssignmentDigest: null,
		});
		const transaction = { toolInvocation: { findUnique: vi.fn().mockResolvedValue(row) } } as unknown as Prisma.TransactionClient;
		const repository = new PrismaToolInvocationRepository(transaction);
		const record = await repository.findById("invocation-1");

		expect(record).toEqual(expect.objectContaining({ authorizationEvidence: {
			principalId: "principal-1",
			actorKind: "user",
			coordinates: [{ resource: { kind: ProductAuthorizationResourceKinds.McpToolRevision, id: "tool-revision-1" }, action: ProductAuthorizationActions.Invoke }],
			decisionDigests: [`sha256:${"b".repeat(64)}`],
			evidenceDigest: `sha256:${"c".repeat(64)}`,
		} }));
	});

	it("rejects task evidence that invents an AgentRun assignment", async function _rejectsTaskAssignmentEvidence()
	{
		const row = _row({ runId: null, attempt: null, mcpTaskId: "mcp-task-1", agentServiceId: null, agentRevisionId: null, authorizationMembershipRevision: null });
		const transaction = { toolInvocation: { findUnique: vi.fn().mockResolvedValue(row) } } as unknown as Prisma.TransactionClient;
		const repository = new PrismaToolInvocationRepository(transaction);

		await expect(repository.findById("invocation-1")).rejects.toThrow("ToolInvocation invocation-1 has invalid task authorization evidence");
	});

	it("rejects a row whose central authorization evidence is only partly stored", async function _rejectsPartialEvidence()
	{
		const row = _row({ authorizationPrincipalId: null });
		const transaction = { toolInvocation: { findUnique: vi.fn().mockResolvedValue(row) } } as unknown as Prisma.TransactionClient;
		const repository = new PrismaToolInvocationRepository(transaction);

		await expect(repository.findById("invocation-1")).rejects.toThrow("ToolInvocation invocation-1 has incomplete authorization evidence");
	});
});
