import { Prisma, SkillAuthoringValidationCompletionOutcome, SkillAuthoringValidationState, SkillAuthoringValidationWorkloadClass, SkillRevisionState, type PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import { SkillAuthoringValidationRecoveryReasons, SkillAuthoringValidationTaskNames } from "@opencrane/backend/agents/skills/workflows/contract";
import { __HashSkillAuthoringValidationBootstrapReference, SKILL_AUTHORING_VALIDATION_SERVICE_ACCOUNT_NAME } from "@opencrane/contracts";

import { PrismaSkillAuthoringValidationControllerUnitOfWork } from "../prisma-skill-authoring-validation-controller-unit-of-work";
import { PrismaSkillAuthoringValidationControllerRepository } from "../skill-authoring-validation-controller-authority";

/** Returns the exact receipt that admission persisted for one skill validation. */
function _Task(): { readonly taskId: string; readonly taskName: SkillAuthoringValidationTaskNames; readonly idempotencyKey: string }
{
	return { taskId: "task-1", taskName: SkillAuthoringValidationTaskNames.Validate, idempotencyKey: `workflows:skill-authoring-validation:${"a".repeat(64)}` };
}

/** Returns one admitted Pending validation without a workload claim. */
function _Validation(): Record<string, unknown>
{
	const task = _Task();
	return { id: "validation-1", siloId: "silo-1", taskId: task.taskId, taskName: task.taskName, taskKey: task.idempotencyKey, state: SkillAuthoringValidationState.Pending, workloadClaim: null };
}

/** Builds a Prisma client double that exposes the exact delegates this authority owns. */
function _Harness(): { readonly authority: PrismaSkillAuthoringValidationControllerUnitOfWork; readonly transaction: Record<string, unknown>; readonly create: ReturnType<typeof vi.fn>; readonly update: ReturnType<typeof vi.fn> }
{
	let validation = _Validation();
	const create = vi.fn(async function _Create(): Promise<void>
	{
		validation = {
			...validation,
			workloadClaim: {
				id: "claim-1",
				workloadClass: SkillAuthoringValidationWorkloadClass.SkillAuthoringValidation,
				profileName: "authoring",
				idempotencyKey: `workflows:skill-authoring-validation-workload:${"b".repeat(64)}`,
				executionReference: "validation-1",
				claimedAt: null,
				deliveryCount: 0,
				expiresAt: null,
				workloadUid: null,
				firstPodUid: null,
			},
		};
	});
	const update = vi.fn(async function _Update(input: { readonly data: { readonly deliveryCount: number } }): Promise<void>
	{
		validation = { ...validation, workloadClaim: { ...(validation["workloadClaim"] as Record<string, unknown>), claimedAt: new Date("2026-08-25T10:00:00.000Z"), expiresAt: new Date("2026-08-25T10:05:00.000Z"), deliveryCount: input.data.deliveryCount + 1 } };
	});
	const transaction = {
		skillAuthoringValidation: { findUnique: vi.fn(async function _Find(): Promise<Record<string, unknown>> { return validation; }) },
		skillAuthoringValidationWorkloadClaim: { create, update },
	};
	const prisma = {
		$transaction: vi.fn(async function _Transaction(work: (client: typeof transaction) => Promise<unknown>, options: { readonly isolationLevel: Prisma.TransactionIsolationLevel }): Promise<unknown>
		{
			expect(options).toEqual({ isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
			return await work(transaction);
		}),
	} as unknown as PrismaClient;
	return { authority: new PrismaSkillAuthoringValidationControllerUnitOfWork(prisma), transaction, create, update };
}

describe("Prisma skill authoring validation controller authority", function _DescribeControllerAuthority()
{
	it("creates a fixed-profile claim and returns a database-clock fenced delivery", async function _ClaimsValidation()
	{
		const harness = _Harness();

		const record = await harness.authority.claimForTask("validation-1", _Task());

		expect(record).toMatchObject({ validationId: "validation-1", siloId: "silo-1", claim: { profileName: "authoring", workloadClass: "skill-authoring-validation", deliveryCount: 1 } });
		expect(Date.parse(record?.claim.expiresAt ?? "")).toBeGreaterThan(Date.parse(record?.claim.claimedAt ?? ""));
		expect(harness.create).toHaveBeenCalledWith({ data: expect.objectContaining({ workloadClass: SkillAuthoringValidationWorkloadClass.SkillAuthoringValidation, profileName: "authoring" }) });
		expect(harness.update).toHaveBeenCalledWith({ where: { id: "claim-1" }, data: { deliveryCount: 0 } });
	});

	it("refuses a task receipt that differs from the one admission saved", async function _RejectsOtherTask()
	{
		const harness = _Harness();

		const otherId = await harness.authority.claimForTask("validation-1", { ..._Task(), taskId: "other-task" });
		const otherName = await harness.authority.claimForTask("validation-1", { ..._Task(), taskName: "skills.other/v1" });

		expect(otherId).toBeNull();
		expect(otherName).toBeNull();
		expect(harness.create).not.toHaveBeenCalled();
	});

	it.each([
		{ state: SkillAuthoringValidationState.Pending, expected: "active" },
		{ state: SkillAuthoringValidationState.Running, expected: "active" },
		{ state: SkillAuthoringValidationState.Succeeded, expected: "completed" },
		{ state: SkillAuthoringValidationState.Failed, expected: "completed" },
		{ state: SkillAuthoringValidationState.Cancelled, expected: "cancelled" },
	])("loads $state as $expected without changing durable state", async function _LoadsCurrentStatus(testCase)
	{
		const validation = { ..._Validation(), state: testCase.state };
		const transaction = { skillAuthoringValidation: { findUnique: vi.fn().mockResolvedValue(validation) } };
		const repository = new PrismaSkillAuthoringValidationControllerRepository(transaction as never);

		await expect(repository.loadCurrentStatus("validation-1", _Task())).resolves.toBe(testCase.expected);
	});

	it("returns a conflict when the status query does not match the admitted task", async function _RejectsStatusForOtherTask()
	{
		const transaction = { skillAuthoringValidation: { findUnique: vi.fn().mockResolvedValue(_Validation()) } };
		const repository = new PrismaSkillAuthoringValidationControllerRepository(transaction as never);

		await expect(repository.loadCurrentStatus("validation-1", { ..._Task(), taskId: "other-task" })).resolves.toBe("conflict");
		await expect(repository.loadCurrentStatus("validation-1", { ..._Task(), taskName: "skills.other/v1" })).resolves.toBe("conflict");
	});

	it("asks the database trigger to renew an expired idempotent bootstrap from database time", async function _RenewsBootstrapWithDatabaseClock()
	{
		const task = _Task();
		const bootstrapReference = `skill-bootstrap-v1_${"c".repeat(64)}`;
		const expiresAt = new Date("2026-08-25T10:05:00.000Z");
		const validation = {
			..._Validation(),
			state: SkillAuthoringValidationState.Running,
			workloadClaim: { id: "claim-1", workloadClass: SkillAuthoringValidationWorkloadClass.SkillAuthoringValidation, profileName: "authoring", idempotencyKey: "workload-key-1", executionReference: "validation-1", claimedAt: new Date("2026-08-25T10:00:00.000Z"), deliveryCount: 2, expiresAt: new Date("2026-08-25T10:10:00.000Z"), workloadUid: "job-uid-1", firstPodUid: null },
			bootstrap: { id: "bootstrap-1", referenceHash: await __HashSkillAuthoringValidationBootstrapReference(bootstrapReference), namespace: "opencrane-skill-authoring", serviceAccount: SKILL_AUTHORING_VALIDATION_SERVICE_ACCOUNT_NAME, expiresAt },
			skillRevision: { state: SkillRevisionState.Draft, testReport: null, scanResult: null },
			completionInbox: null,
		};
		const update = vi.fn().mockResolvedValue(undefined);
		const transaction = { skillAuthoringValidation: { findUnique: vi.fn().mockResolvedValue(validation) }, skillAuthoringValidationBootstrap: { update } };
		const repository = new PrismaSkillAuthoringValidationControllerRepository(transaction as never);

		await expect(repository.bindWorkload("validation-1", task, { bootstrapReference, namespace: "opencrane-skill-authoring", binding: { claimId: "claim-1", profileName: "authoring", claimedAt: "2026-08-25T10:00:00.000Z", deliveryCount: 2, workloadUid: "job-uid-1" } })).resolves.toBe("idempotent");
		expect(update).toHaveBeenCalledWith({ where: { id: "bootstrap-1" }, data: { expiresAt } });
	});

	it("lets database time reject an expired unbound Job before the trigger write", async function _RejectsExpiredUnboundBind()
	{
		const task = _Task();
		const updateMany = vi.fn();
		const validation = {
			..._Validation(),
			workloadClaim: { id: "claim-1", workloadClass: SkillAuthoringValidationWorkloadClass.SkillAuthoringValidation, profileName: "authoring", idempotencyKey: "workload-key-1", executionReference: "validation-1", claimedAt: new Date("2026-08-25T10:00:00.000Z"), deliveryCount: 1, expiresAt: new Date("2026-08-25T10:05:00.000Z"), workloadUid: null, firstPodUid: null },
			bootstrap: null,
			skillRevision: { state: SkillRevisionState.Draft, testReport: null, scanResult: null },
			completionInbox: null,
		};
		const transaction = {
			skillAuthoringValidation: { findUnique: vi.fn().mockResolvedValue(validation) },
			skillAuthoringValidationWorkloadClaim: { updateMany },
			skillAuthorityClock: { findUnique: vi.fn().mockResolvedValue({ now: new Date("2026-08-25T10:05:00.000Z") }) },
		};
		const repository = new PrismaSkillAuthoringValidationControllerRepository(transaction as never);
		const binding = { claimId: "claim-1", profileName: "authoring", claimedAt: "2026-08-25T10:00:00.000Z", deliveryCount: 1, workloadUid: "job-uid-1" };

		await expect(repository.bindWorkload("validation-1", task, { bootstrapReference: `skill-bootstrap-v1_${"c".repeat(64)}`, namespace: "opencrane-skill-authoring", binding })).resolves.toBe("expired");
		expect(updateMany).not.toHaveBeenCalled();
	});

	it.each([
		{ databaseNow: "2026-08-25T10:04:59.000Z", expected: { outcome: "authorized", releaseLifetimeSeconds: 1 } },
		{ databaseNow: "2026-08-25T10:05:00.000Z", expected: "expired" },
	])("authorizes release from database time", async function _AuthorizesRelease(testCase)
	{
		const validation = {
			..._Validation(),
			state: SkillAuthoringValidationState.Running,
			workloadClaim: { id: "claim-1", workloadClass: SkillAuthoringValidationWorkloadClass.SkillAuthoringValidation, profileName: "authoring", idempotencyKey: "workload-key-1", executionReference: "validation-1", claimedAt: new Date("2026-08-25T10:00:00.000Z"), deliveryCount: 1, expiresAt: new Date("2026-08-25T10:05:00.000Z"), workloadUid: "job-uid-1", firstPodUid: null },
		};
		const transaction = { skillAuthoringValidation: { findUnique: vi.fn().mockResolvedValue(validation) }, skillAuthorityClock: { findUnique: vi.fn().mockResolvedValue({ now: new Date(testCase.databaseNow) }) } };
		const repository = new PrismaSkillAuthoringValidationControllerRepository(transaction as never);
		const binding = { claimId: "claim-1", profileName: "authoring", claimedAt: "2026-08-25T10:00:00.000Z", deliveryCount: 1, workloadUid: "job-uid-1" };

		await expect(repository.authorizeRelease("validation-1", _Task(), binding)).resolves.toEqual(testCase.expected);
	});

	it("does not bind a first Pod after database expiry", async function _RejectsExpiredPodBind()
	{
		const updateMany = vi.fn();
		const validation = {
			..._Validation(),
			state: SkillAuthoringValidationState.Running,
			workloadClaim: { id: "claim-1", workloadClass: SkillAuthoringValidationWorkloadClass.SkillAuthoringValidation, profileName: "authoring", idempotencyKey: "workload-key-1", executionReference: "validation-1", claimedAt: new Date("2026-08-25T10:00:00.000Z"), deliveryCount: 1, expiresAt: new Date("2026-08-25T10:05:00.000Z"), workloadUid: "job-uid-1", firstPodUid: null },
		};
		const transaction = { skillAuthoringValidation: { findUnique: vi.fn().mockResolvedValue(validation) }, skillAuthoringValidationWorkloadClaim: { updateMany }, skillAuthorityClock: { findUnique: vi.fn().mockResolvedValue({ now: new Date("2026-08-25T10:05:00.000Z") }) } };
		const repository = new PrismaSkillAuthoringValidationControllerRepository(transaction as never);
		const binding = { claimId: "claim-1", profileName: "authoring", claimedAt: "2026-08-25T10:00:00.000Z", deliveryCount: 1, workloadUid: "job-uid-1", firstPodUid: "pod-uid-1" };

		await expect(repository.bindFirstPod("validation-1", _Task(), { binding })).resolves.toBe("expired");
		expect(updateMany).not.toHaveBeenCalled();
	});

	it("does not issue a delivery beyond the reviewed claim budget", async function _CapsClaimDeliveries()
	{
		const task = _Task();
		const update = vi.fn();
		const validation = {
			..._Validation(),
			workloadClaim: { id: "claim-1", workloadClass: SkillAuthoringValidationWorkloadClass.SkillAuthoringValidation, profileName: "authoring", idempotencyKey: "workload-key-1", executionReference: "validation-1", claimedAt: new Date("2026-08-25T10:00:00.000Z"), deliveryCount: 3, expiresAt: new Date("2026-08-25T10:05:00.000Z"), workloadUid: null, firstPodUid: null },
		};
		const transaction = { skillAuthoringValidation: { findUnique: vi.fn().mockResolvedValue(validation) }, skillAuthoringValidationWorkloadClaim: { update } };
		const repository = new PrismaSkillAuthoringValidationControllerRepository(transaction as never);

		await expect(repository.claimForTask("validation-1", task)).resolves.toMatchObject({ claim: { deliveryCount: 3 } });
		expect(update).not.toHaveBeenCalled();
	});

	it("uses database time to fail the final expired claim before workload binding", async function _FailsFinalUnboundClaim()
	{
		const task = _Task();
		const claimedAt = new Date("2026-08-25T10:00:00.000Z");
		const expiresAt = new Date("2026-08-25T10:05:00.000Z");
		const claim = { claimId: "claim-1", siloId: "silo-1", workloadClass: "skill-authoring-validation" as const, profileName: "authoring", idempotencyKey: "workload-key-1", executionReference: "validation-1", claimedAt: claimedAt.toISOString(), deliveryCount: 3, expiresAt: expiresAt.toISOString() };
		const validation = {
			..._Validation(),
			failureCode: null,
			workloadClaim: { id: claim.claimId, workloadClass: SkillAuthoringValidationWorkloadClass.SkillAuthoringValidation, profileName: claim.profileName, idempotencyKey: claim.idempotencyKey, executionReference: claim.executionReference, claimedAt, deliveryCount: claim.deliveryCount, expiresAt, workloadUid: null, firstPodUid: null },
		};
		const updateMany = vi.fn().mockResolvedValue({ count: 1 });
		const transaction = { skillAuthoringValidation: { findUnique: vi.fn().mockResolvedValue(validation), updateMany }, skillAuthorityClock: { findUnique: vi.fn().mockResolvedValue({ singleton: 1, now: new Date("2026-08-25T10:05:01.000Z") }) } };
		const repository = new PrismaSkillAuthoringValidationControllerRepository(transaction as never);

		await expect(repository.failExpiredBeforeWorkload("validation-1", task, claim)).resolves.toBe("failed");
		expect(updateMany).toHaveBeenCalledWith({ where: { id: "validation-1", state: SkillAuthoringValidationState.Pending }, data: { state: SkillAuthoringValidationState.Failed, failureCode: SkillAuthoringValidationRecoveryReasons.ClaimExpiredBeforeWorkload } });
	});

	it("keeps the final unbound claim active until database time reaches its expiry", async function _WaitsForFinalUnboundClaim()
	{
		const task = _Task();
		const claimedAt = new Date("2026-08-25T10:00:00.000Z");
		const expiresAt = new Date("2026-08-25T10:05:00.000Z");
		const claim = { claimId: "claim-1", siloId: "silo-1", workloadClass: "skill-authoring-validation" as const, profileName: "authoring", idempotencyKey: "workload-key-1", executionReference: "validation-1", claimedAt: claimedAt.toISOString(), deliveryCount: 3, expiresAt: expiresAt.toISOString() };
		const validation = { ..._Validation(), failureCode: null, workloadClaim: { id: claim.claimId, workloadClass: SkillAuthoringValidationWorkloadClass.SkillAuthoringValidation, profileName: claim.profileName, idempotencyKey: claim.idempotencyKey, executionReference: claim.executionReference, claimedAt, deliveryCount: claim.deliveryCount, expiresAt, workloadUid: null, firstPodUid: null } };
		const updateMany = vi.fn();
		const transaction = { skillAuthoringValidation: { findUnique: vi.fn().mockResolvedValue(validation), updateMany }, skillAuthorityClock: { findUnique: vi.fn().mockResolvedValue({ singleton: 1, now: new Date("2026-08-25T10:04:59.999Z") }) } };
		const repository = new PrismaSkillAuthoringValidationControllerRepository(transaction as never);

		await expect(repository.failExpiredBeforeWorkload("validation-1", task, claim)).resolves.toBe("not_expired");
		expect(updateMany).not.toHaveBeenCalled();
	});

	it.each([
		{ description: "waits for premature bound expiry", databaseNow: "2026-08-25T10:04:59.000Z", expected: "not_expired", updates: 0 },
		{ description: "accepts expired bound work", databaseNow: "2026-08-25T10:05:00.000Z", expected: "failed", updates: 1 },
	])("$description using database time", async function _FencesBoundExpiry(testCase)
	{
		const updateMany = vi.fn().mockResolvedValue({ count: 1 });
		const validation = {
			..._Validation(),
			state: SkillAuthoringValidationState.Running,
			failureCode: null,
			workloadClaim: { id: "claim-1", workloadClass: SkillAuthoringValidationWorkloadClass.SkillAuthoringValidation, profileName: "authoring", idempotencyKey: "workload-key-1", executionReference: "validation-1", claimedAt: new Date("2026-08-25T10:00:00.000Z"), deliveryCount: 1, expiresAt: new Date("2026-08-25T10:05:00.000Z"), workloadUid: "job-uid-1", firstPodUid: null },
			completionInbox: null,
		};
		const transaction = {
			skillAuthoringValidation: { findUnique: vi.fn().mockResolvedValue(validation), updateMany },
			skillAuthorityClock: { findUnique: vi.fn().mockResolvedValue({ singleton: 1, now: new Date(testCase.databaseNow) }) },
		};
		const repository = new PrismaSkillAuthoringValidationControllerRepository(transaction as never);
		const binding = { claimId: "claim-1", claimedAt: "2026-08-25T10:00:00.000Z", deliveryCount: 1, profileName: "authoring", workloadUid: "job-uid-1" };

		await expect(repository.failUnreported("validation-1", _Task(), binding, SkillAuthoringValidationRecoveryReasons.ClaimExpiredWithoutWorker)).resolves.toBe(testCase.expected);
		expect(updateMany).toHaveBeenCalledTimes(testCase.updates);
	});

	it("copies successful worker reports to the exact Draft revision before completing the validation", async function _CopiesTerminalEvidence()
	{
		const testReport = { passed: true, summary: "tests passed", checksRun: 3 };
		const scanResult = { passed: true, summary: "scan passed", checksRun: 2 };
		const skillRevisionUpdate = vi.fn().mockResolvedValue({ count: 1 });
		const validationUpdate = vi.fn().mockResolvedValue({ count: 1 });
		const validation = {
			..._Validation(),
			skillRevisionId: "revision-1",
			state: SkillAuthoringValidationState.Running,
			skillRevision: { state: SkillRevisionState.Draft, testReport: null, scanResult: null },
			completionInbox: { completionDigest: `sha256:${"c".repeat(64)}`, outcome: SkillAuthoringValidationCompletionOutcome.Succeeded, testReport, scanResult, failureCode: null },
		};
		const transaction = {
			skillAuthoringValidation: { findUnique: vi.fn().mockResolvedValue(validation), updateMany: validationUpdate },
			skillRevision: { updateMany: skillRevisionUpdate },
		};
		const prisma = { $transaction: vi.fn(async function _Transaction(work: (client: typeof transaction) => Promise<unknown>) { return await work(transaction); }) } as unknown as PrismaClient;
		const authority = new PrismaSkillAuthoringValidationControllerUnitOfWork(prisma);

		const outcome = await authority.complete("validation-1", { validationId: "validation-1", completionDigest: validation.completionInbox.completionDigest }, _Task());

		expect(outcome).toBe("completed");
		expect(skillRevisionUpdate).toHaveBeenCalledWith({ where: { id: "revision-1", state: SkillRevisionState.Draft, testReport: { equals: Prisma.DbNull }, scanResult: { equals: Prisma.DbNull } }, data: { testReport, scanResult } });
		expect(validationUpdate).toHaveBeenCalledWith({ where: { id: "validation-1", state: SkillAuthoringValidationState.Running }, data: { state: SkillAuthoringValidationState.Succeeded, failureCode: null } });
	});

	it("applies a saved worker failure without changing the Draft revision", async function _AppliesWorkerFailure()
	{
		const skillRevisionUpdate = vi.fn();
		const validationUpdate = vi.fn().mockResolvedValue({ count: 1 });
		const completionDigest = `sha256:${"e".repeat(64)}`;
		const validation = {
			..._Validation(),
			skillRevisionId: "revision-1",
			state: SkillAuthoringValidationState.Running,
			skillRevision: { state: SkillRevisionState.Draft, testReport: null, scanResult: null },
			completionInbox: { completionDigest, outcome: SkillAuthoringValidationCompletionOutcome.Failed, testReport: null, scanResult: null, failureCode: "checks_failed" },
		};
		const transaction = {
			skillAuthoringValidation: { findUnique: vi.fn().mockResolvedValue(validation), updateMany: validationUpdate },
			skillRevision: { updateMany: skillRevisionUpdate },
		};
		const prisma = { $transaction: vi.fn(async function _Transaction(work: (client: typeof transaction) => Promise<unknown>) { return await work(transaction); }) } as unknown as PrismaClient;
		const authority = new PrismaSkillAuthoringValidationControllerUnitOfWork(prisma);

		await expect(authority.complete("validation-1", { validationId: "validation-1", completionDigest }, _Task())).resolves.toBe("completed");
		expect(skillRevisionUpdate).not.toHaveBeenCalled();
		expect(validationUpdate).toHaveBeenCalledWith({ where: { id: "validation-1", state: SkillAuthoringValidationState.Running }, data: { state: SkillAuthoringValidationState.Failed, failureCode: "checks_failed" } });
	});

	it("loads saved completion and fences task-owned recovery to the exact Job delivery", async function _RecoversUnreportedJob()
	{
		const updateMany = vi.fn().mockResolvedValue({ count: 1 });
		const validation = {
			..._Validation(),
			skillRevisionId: "revision-1",
			state: SkillAuthoringValidationState.Running,
			failureCode: null,
			workloadClaim: { id: "claim-1", workloadClass: SkillAuthoringValidationWorkloadClass.SkillAuthoringValidation, profileName: "authoring", idempotencyKey: "workload-key-1", executionReference: "validation-1", claimedAt: new Date("2026-08-25T10:00:00.000Z"), deliveryCount: 1, expiresAt: new Date("2026-08-25T10:05:00.000Z"), workloadUid: "job-uid-1", firstPodUid: "pod-uid-1" },
			bootstrap: null,
			skillRevision: { state: SkillRevisionState.Draft, testReport: null, scanResult: null },
			completionInbox: { completionDigest: `sha256:${"d".repeat(64)}`, outcome: SkillAuthoringValidationCompletionOutcome.Failed, testReport: null, scanResult: null, failureCode: "checks_failed" },
		};
		const recoveryValidation = { ...validation, completionInbox: null };
		const findUnique = vi.fn().mockResolvedValueOnce(validation).mockResolvedValue(recoveryValidation);
		const transaction = { skillAuthoringValidation: { findUnique, updateMany } };
		const prisma = { $transaction: vi.fn(async function _Transaction(work: (client: typeof transaction) => Promise<unknown>) { return await work(transaction); }) } as unknown as PrismaClient;
		const authority = new PrismaSkillAuthoringValidationControllerUnitOfWork(prisma);
		const binding = { claimId: "claim-1", claimedAt: "2026-08-25T10:00:00.000Z", deliveryCount: 1, profileName: "authoring", workloadUid: "job-uid-1", firstPodUid: "pod-uid-1" };

		await expect(authority.loadCurrentCompletion("validation-1", _Task())).resolves.toEqual({ validationId: "validation-1", completionDigest: validation.completionInbox.completionDigest });
		await expect(authority.failUnreported("validation-1", _Task(), binding, SkillAuthoringValidationRecoveryReasons.JobTerminalWithoutCompletion)).resolves.toBe("failed");
		expect(updateMany).toHaveBeenCalledWith({ where: { id: "validation-1", state: SkillAuthoringValidationState.Running }, data: { state: SkillAuthoringValidationState.Failed, failureCode: SkillAuthoringValidationRecoveryReasons.JobTerminalWithoutCompletion } });
		await expect(authority.failUnreported("validation-1", _Task(), { ...binding, profileName: "invalid-authoring" }, SkillAuthoringValidationRecoveryReasons.JobTerminalWithoutCompletion)).resolves.toBe("conflict");
	});
});
