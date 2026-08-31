import { SkillRevisionState, SkillTrustClass } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import { SkillAuthoringValidationTaskNames } from "@opencrane/backend/agents/skills/workflows/contract";

import { PrismaSkillAuthoringValidationSubmissionUnitOfWork } from "../prisma-skill-authoring-validation-submission";

/** Build one transaction harness that satisfies validation admission and task binding. */
function _Harness()
{
	const transaction = {
		skillRevision: {
			findFirst: vi.fn().mockResolvedValue({ id: "revision-1", artifactRevisionId: "artifact-revision-1", artifactContentAddress: `sha256:${"a".repeat(64)}` }),
			findUnique: vi.fn().mockResolvedValue({ skill: { siloId: "silo-a" }, state: SkillRevisionState.Draft, trustClass: SkillTrustClass.SandboxedPython, artifactRevisionId: "artifact-revision-1", artifactContentAddress: `sha256:${"a".repeat(64)}` }),
		},
		artifactRevision: { findFirst: vi.fn().mockResolvedValue({ id: "artifact-revision-1" }) },
		skillAuthoringValidation: {
			upsert: vi.fn().mockResolvedValue({ id: "validation-1", siloId: "silo-a", skillRevisionId: "revision-1", artifactRevisionId: "artifact-revision-1", artifactContentAddress: `sha256:${"a".repeat(64)}`, taskId: null, taskName: null, taskKey: expect.any(String) }),
			findUnique: vi.fn(),
			updateMany: vi.fn().mockResolvedValue({ count: 1 }),
		},
	};
	transaction.skillAuthoringValidation.upsert.mockImplementation(async function _Upsert(input: { readonly create: { readonly taskKey: string } })
	{
		return { id: "validation-1", siloId: "silo-a", skillRevisionId: "revision-1", artifactRevisionId: "artifact-revision-1", artifactContentAddress: `sha256:${"a".repeat(64)}`, taskId: null, taskName: null, taskKey: input.create.taskKey };
	});
	transaction.skillAuthoringValidation.findUnique.mockImplementation(async function _FindValidation()
	{
		const saved = await transaction.skillAuthoringValidation.upsert.mock.results.at(-1)?.value;
		return saved ?? null;
	});
	const prisma = { $transaction: vi.fn(async function _Transaction(callback: (client: typeof transaction) => Promise<unknown>) { return callback(transaction); }) };
	const workflow = {
		spawn: vi.fn().mockImplementation(async function _Spawn(_context: unknown, command: { readonly taskName: string; readonly idempotencyKey: string })
		{
			return { taskId: "task-1", taskName: command.taskName, idempotencyKey: command.idempotencyKey };
		}),
	};
	return { transaction, prisma, workflow };
}

describe("Prisma skill authoring validation submission unit of work", function _DescribeSubmissionUnitOfWork()
{
	it("derives artifact facts and saves the remote task through the same transaction", async function _SubmitsAtomically()
	{
		const harness = _Harness();
		const authority = new PrismaSkillAuthoringValidationSubmissionUnitOfWork(harness.prisma as never, harness.workflow as never);

		const result = await authority.submit({ siloId: "silo-a", principalId: "principal-1" }, "revision-1");

		expect(result).toEqual({ validationId: "validation-1", taskId: "task-1" });
		expect(harness.transaction.skillRevision.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "revision-1", skill: { siloId: "silo-a", ownerPrincipalId: "principal-1" } } }));
		expect(harness.workflow.spawn).toHaveBeenCalledWith({ client: harness.transaction }, expect.objectContaining({ taskName: SkillAuthoringValidationTaskNames.Validate, input: { siloId: "silo-a", validationId: "validation-1" } }));
		expect(harness.transaction.skillAuthoringValidation.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: { taskId: "task-1", taskName: SkillAuthoringValidationTaskNames.Validate } }));
	});

	it("rejects a revision outside the authenticated silo before saving a task", async function _RejectsForeignRevision()
	{
		const harness = _Harness();
		harness.transaction.skillRevision.findFirst.mockResolvedValue(null);
		const authority = new PrismaSkillAuthoringValidationSubmissionUnitOfWork(harness.prisma as never, harness.workflow as never);

		await expect(authority.submit({ siloId: "silo-a", principalId: "principal-1" }, "foreign-revision")).rejects.toThrow(/requires ownership/);

		expect(harness.workflow.spawn).not.toHaveBeenCalled();
		expect(harness.transaction.skillAuthoringValidation.upsert).not.toHaveBeenCalled();
	});
});
