import { Prisma, SkillAuthoringValidationState, SkillAuthoringValidationWorkloadClass, type PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import { SkillAuthoringValidationTaskNames } from "@opencrane/backend/agents/skills/workflows/contract";

import { PrismaSkillAuthoringValidationControllerUnitOfWork } from "../prisma-skill-authoring-validation-controller-unit-of-work";

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

		const record = await harness.authority.claimForTask("validation-1", { ..._Task(), taskId: "other-task" });

		expect(record).toBeNull();
		expect(harness.create).not.toHaveBeenCalled();
	});
});
