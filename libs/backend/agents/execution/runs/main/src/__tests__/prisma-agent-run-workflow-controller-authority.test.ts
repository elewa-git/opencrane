import { AgentRunState, AgentServiceKind, AgentServiceState, WorkloadAssignmentState, type PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import { AgentRunTaskNames, type AgentRunWorkflowAssignmentCommand, type AgentRunWorkflowPodCommand } from "@opencrane/backend/agents/execution/runs/workflows/contract";
import type { IWorkflowTaskReceipt } from "@opencrane/backend/server/infra/workflows/contract";

import { PrismaAgentRunWorkflowControllerUnitOfWork } from "../prisma-agent-run-workflow-controller-unit-of-work";
import type { AgentRunWorkflowControllerAuthorityOptions } from "../agent-run-workflow-controller-authority.types";

/** Returns the receipt that AgentRun workflow admission saved for this fixture. */
function _Receipt(): IWorkflowTaskReceipt
{
	return { taskId: "task-1", taskName: AgentRunTaskNames.Execute, idempotencyKey: "agent-run:silo-1:run-1:attempt:1" };
}

/** Returns the fixed input used by the controller task. */
function _Input(): { readonly siloId: string; readonly runId: string; readonly attempt: number }
{
	return { siloId: "silo-1", runId: "run-1", attempt: 1 };
}

/** Returns the Job identity that a Kubernetes controller reports after creating a suspended Job. */
function _Assignment(): AgentRunWorkflowAssignmentCommand
{
	return { workloadUid: "job-uid-1", workloadProfile: "personal-small", serviceAccountName: "agent-runtime-default" };
}

/** Returns the first Job-owned Pod identity that a controller reports after releasing the Job. */
function _Pod(): AgentRunWorkflowPodCommand
{
	return { workloadUid: "job-uid-1", podUid: "pod-uid-1" };
}

/** Builds one server-owned runtime configuration with a deterministic model-key issuer. */
function _Options(sequence: string[], keyAliases: string[]): AgentRunWorkflowControllerAuthorityOptions
{
	const issueAttemptModelKey = Object.assign(
		vi.fn(async function _Issue(request) { sequence.push("issuer"); keyAliases.push(request.keyAlias); return { key: "sk-transient" }; }),
		{ revokeAttemptKey: vi.fn(async function _Revoke() { sequence.push("revoke"); }) },
	);
	return {
		personalRuntimeNamespace: "runtime-personal",
		managedRuntimeNamespace: "runtime-managed",
		assignmentTtlMilliseconds: 3_600_000,
		releaseLeaseMilliseconds: 30_000,
		orphanObservationMarginMilliseconds: 10_000,
		issueAttemptModelKey,
	};
}

/** Builds a mutable Prisma double that exposes the rows owned by this controller authority. */
function _Harness(state: AgentRunState = AgentRunState.Accepted): { readonly authority: PrismaAgentRunWorkflowControllerUnitOfWork; readonly transaction: Record<string, unknown>; readonly run: Record<string, unknown>; readonly task: Record<string, unknown>; readonly sequence: string[]; readonly keyAliases: string[] }
{
	const sequence: string[] = [];
	const keyAliases: string[] = [];
	const run: Record<string, unknown> = {
		id: "run-1",
		siloId: "silo-1",
		attempt: 1,
		state,
		agentServiceId: "service-1",
		agentRevisionId: "revision-1",
		inputSnapshotDigest: `sha256:${"a".repeat(64)}`,
		effectiveContractDigest: `sha256:${"b".repeat(64)}`,
		conversationId: null,
		service: { id: "service-1", siloId: "silo-1", kind: AgentServiceKind.Personal, state: AgentServiceState.Active, activeRevisionId: "revision-1", workloadProfile: "personal-small" },
		inputSnapshot: {
			runId: "run-1",
			siloId: "silo-1",
			agentServiceId: "service-1",
			agentRevisionId: "revision-1",
			effectiveContractDigest: `sha256:${"b".repeat(64)}`,
			conversationId: null,
			digest: `sha256:${"a".repeat(64)}`,
			identitySnapshot: { kind: "user", executionSubjectId: "user-1", fleetMembershipTrustedUntil: "2027-01-01T00:00:00.000Z" },
			modelRoute: { alias: "silo-default" },
			budgetPolicy: { maxCostUsdMicros: 5_000_000 },
		},
	};
	const task: Record<string, unknown> = { runId: "run-1", attempt: 1, siloId: "silo-1", taskId: "task-1", taskKey: "agent-run:silo-1:run-1:attempt:1", taskName: AgentRunTaskNames.Execute, assignmentExpiresAt: null, releaseClaimedAt: null, releaseExpiresAt: null, releaseDeliveryCount: 0, attemptKeyDigest: null, run };
	let assignment: Record<string, unknown> | null = null;
	let bootstrap: Record<string, unknown> | null = null;
	const transaction = {
		agentRunWorkflowTask: {
			findUnique: vi.fn(async function _FindTask() { return task; }),
			updateMany: vi.fn(async function _UpdateTask(input: { readonly where: Record<string, unknown>; readonly data: Record<string, unknown> })
			{
				for (const [key, value] of Object.entries(input.where))
				{
					if (task[key] !== value)
					{
						return { count: 0 };
					}
				}
				Object.assign(task, input.data);
				return { count: 1 };
			}),
		},
		workloadAssignment: {
			findUnique: vi.fn(async function _FindAssignment() { return assignment; }),
			create: vi.fn(async function _CreateAssignment(input: { readonly data: Record<string, unknown> }) { assignment = { podUid: null, ...input.data }; return assignment; }),
			updateMany: vi.fn(async function _UpdateAssignment(input: { readonly where: Record<string, unknown>; readonly data: Record<string, unknown> })
			{
				if (assignment === null || assignment["workloadUid"] !== input.where["workloadUid"] || assignment["podUid"] !== input.where["podUid"])
				{
					return { count: 0 };
				}
				assignment = { ...assignment, ...input.data };
				return { count: 1 };
			}),
		},
		workloadBootstrap: {
			findUnique: vi.fn(async function _FindBootstrap() { return bootstrap; }),
			create: vi.fn(async function _CreateBootstrap(input: { readonly data: Record<string, unknown> }) { bootstrap = input.data; return bootstrap; }),
		},
		agentRun: { updateMany: vi.fn(async function _UpdateRun(input: { readonly where: Record<string, unknown>; readonly data: Record<string, unknown> })
		{
			if (run["state"] !== input.where["state"])
			{
				return { count: 0 };
			}
			run["state"] = input.data["state"];
			return { count: 1 };
		}) },
	};
	const prisma = {
		$transaction: vi.fn(async function _Transaction(work: (client: typeof transaction) => Promise<unknown>)
		{
			const result = await work(transaction);
			sequence.push("commit");
			return result;
		}),
	} as unknown as PrismaClient;
	return { authority: new PrismaAgentRunWorkflowControllerUnitOfWork(prisma, _Options(sequence, keyAliases)), transaction, run, task, sequence, keyAliases };
}

describe("Prisma AgentRun workflow controller authority", function _DescribeAgentRunWorkflowControllerAuthority()
{
	it("rejects a receipt that differs from the saved workflow task", async function _RejectsOtherReceipt()
	{
		const harness = _Harness();

		await expect(harness.authority.loadForTask(_Input(), { ..._Receipt(), taskId: "other-task" })).resolves.toBeNull();
		expect((harness.transaction["workloadAssignment"] as { readonly create: ReturnType<typeof vi.fn> }).create).not.toHaveBeenCalled();
	});

	it("stops a stale retry and reports a cancellation as terminal", async function _StopsStaleAndCancelledTask()
	{
		const stale = _Harness();
		stale.run["attempt"] = 2;
		const cancelled = _Harness(AgentRunState.Cancelling);

		await expect(stale.authority.loadForTask(_Input(), _Receipt())).resolves.toBeNull();
		await expect(stale.authority.observe(_Input(), _Receipt())).resolves.toBe("stale");
		await expect(cancelled.authority.observe(_Input(), _Receipt())).resolves.toBe("cancelled");
	});

	it("mints the model key after the task-fenced transaction commits", async function _MintsAfterCommit()
	{
		const harness = _Harness();

		await expect(harness.authority.mintAttemptKey(_Input(), _Receipt())).resolves.toMatchObject({ key: "sk-transient", keyAlias: expect.stringMatching(/^attempt-[0-9a-f]{32}$/) });
		expect(harness.sequence).toEqual(["commit", "issuer", "commit"]);
		expect(harness.task["attemptKeyDigest"]).toMatch(/^sha256:[0-9a-f]{64}$/);
		expect(JSON.stringify(harness.task)).not.toContain("sk-transient");
	});

	it("refuses to revoke a key whose digest does not match the saved task", async function _RefusesMismatchedKeyRevocation()
	{
		const harness = _Harness();
		const minted = await harness.authority.mintAttemptKey(_Input(), _Receipt());
		expect(minted).not.toBeNull();

		await expect(harness.authority.revokeAttemptKey(_Input(), _Receipt(), { key: "sk-different", keyAlias: minted!.keyAlias })).rejects.toThrow("does not match the saved task");
		expect(harness.sequence).not.toContain("revoke");
	});

	it("uses the same model-key alias for each retry without changing the saved task", async function _ReusesModelKeyAlias()
	{
		const harness = _Harness();

		await harness.authority.mintAttemptKey(_Input(), _Receipt());
		await harness.authority.mintAttemptKey(_Input(), _Receipt());
		expect(harness.keyAliases).toHaveLength(2);
		expect(harness.keyAliases[0]).toBe(harness.keyAliases[1]);
	});

	it("binds one Job and makes its exact replay idempotent while rejecting a replacement Job", async function _BindsJobOnce()
	{
		const harness = _Harness();

		await expect(harness.authority.bindAssignment(_Input(), _Receipt(), _Assignment())).resolves.toBe("bound");
		await expect(harness.authority.bindAssignment(_Input(), _Receipt(), _Assignment())).resolves.toBe("idempotent");
		await expect(harness.authority.bindAssignment(_Input(), _Receipt(), { ..._Assignment(), workloadUid: "job-uid-2" })).resolves.toBe("conflict");
	});

	it("rolls back when the lifecycle transition loses its fence before an assignment is written", async function _RollsBackLostTransition()
	{
		const harness = _Harness();
		(harness.transaction["agentRun"] as { readonly updateMany: ReturnType<typeof vi.fn> }).updateMany.mockResolvedValueOnce({ count: 0 });

		await expect(harness.authority.bindAssignment(_Input(), _Receipt(), _Assignment())).rejects.toThrow("accepted-to-queued transition");
		expect((harness.transaction["workloadAssignment"] as { readonly create: ReturnType<typeof vi.fn> }).create).not.toHaveBeenCalled();
		expect(harness.sequence).not.toContain("commit");
	});

	it("returns the saved assignment expiry when a handler reloads an exact Job binding", async function _ReloadsPersistedAssignmentExpiry()
	{
		const harness = _Harness();
		await harness.authority.bindAssignment(_Input(), _Receipt(), _Assignment());

		const record = await harness.authority.loadForTask(_Input(), _Receipt());
		expect(record?.assignmentExpiresAt).toBe((harness.task["assignmentExpiresAt"] as Date).toISOString());
	});

	it("binds one first Pod and rejects another Pod for the same Job", async function _BindsPodOnce()
	{
		const harness = _Harness();
		await harness.authority.bindAssignment(_Input(), _Receipt(), _Assignment());

		await expect(harness.authority.bindFirstPod(_Input(), _Receipt(), _Pod())).resolves.toBe("bound");
		await expect(harness.authority.bindFirstPod(_Input(), _Receipt(), _Pod())).resolves.toBe("idempotent");
		await expect(harness.authority.bindFirstPod(_Input(), _Receipt(), { ..._Pod(), podUid: "pod-uid-2" })).resolves.toBe("conflict");
	});

	it("takes one release lease and observes terminal run state without changing it", async function _ClaimsReleaseAndObservesTerminalState()
	{
		const harness = _Harness();
		await harness.authority.bindAssignment(_Input(), _Receipt(), _Assignment());

		const first = await harness.authority.claimRelease(_Input(), _Receipt(), "job-uid-1");
		const second = await harness.authority.claimRelease(_Input(), _Receipt(), "job-uid-1");
		expect(first).toMatchObject({ expiresAt: expect.any(String) });
		expect(second).toEqual(first);
		expect(harness.task).toMatchObject({ releaseClaimedAt: expect.any(Date), releaseExpiresAt: expect.any(Date), releaseDeliveryCount: 1 });
		expect(harness.transaction["outboxEvent"]).toBeUndefined();
		harness.run["state"] = AgentRunState.Completed;
		await expect(harness.authority.observe(_Input(), _Receipt())).resolves.toBe("completed");
	});
});
