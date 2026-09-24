import { SkillRevisionState, SkillTrustClass } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import { SkillAuthoringValidationTaskNames } from "@opencrane/backend/agents/skills/workflows/contract";
import { AuthorizationDecisionOutcomes, ProductAuthorizationActions, ProductAuthorizationResourceKinds } from "@opencrane/models/authorization";

import { PrismaSkillAuthoringValidationSubmissionRepository } from "../prisma-skill-authoring-validation-submission-repository";

/** Build one transaction harness that satisfies validation admission and task binding. */
function _Harness()
{
	const transaction = {
		skillRevision: {
			findFirst: vi.fn().mockResolvedValue({ id: "revision-1", artifactRevisionId: "artifact-revision-1", artifactContentAddress: `sha256:${"a".repeat(64)}`, skill: { ownerPrincipalId: "principal-owner" } }),
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
	const workflow = {
		spawn: vi.fn().mockImplementation(async function _Spawn(_context: unknown, command: { readonly taskName: string; readonly idempotencyKey: string })
		{
			return { taskId: "task-1", taskName: command.taskName, idempotencyKey: command.idempotencyKey };
		}),
	};
	const authorization = { admitPrincipal: vi.fn().mockResolvedValue({ outcome: AuthorizationDecisionOutcomes.Allow }) };
	return { transaction, workflow, authorization };
}

describe("Prisma skill authoring validation submission repository", function _DescribeSubmissionRepository()
{
	it("derives artifact facts and saves the remote task through the same transaction", async function _SubmitsAtomically()
	{
		const harness = _Harness();
		const authority = new PrismaSkillAuthoringValidationSubmissionRepository(harness.transaction as never, harness.workflow as never, harness.authorization as never);

		const result = await authority.submit({ siloId: "silo-a", principalId: "principal-1" }, "revision-1");

		expect(result).toEqual({ validationId: "validation-1", taskId: "task-1" });
		expect(harness.transaction.skillRevision.findFirst).toHaveBeenCalledWith({ where: { id: "revision-1", skill: { siloId: "silo-a" } }, select: { id: true, artifactRevisionId: true, artifactContentAddress: true, skill: { select: { ownerPrincipalId: true } } } });
		expect(harness.authorization.admitPrincipal).toHaveBeenCalledWith(expect.objectContaining({ siloId: "silo-a", principalId: "principal-1", action: ProductAuthorizationActions.Review, resource: { kind: ProductAuthorizationResourceKinds.SkillRevision, id: "revision-1" }, actorKind: "user", actorId: "principal-1" }));
		expect(harness.workflow.spawn).toHaveBeenCalledWith({ client: harness.transaction }, expect.objectContaining({ taskName: SkillAuthoringValidationTaskNames.Validate, input: { siloId: "silo-a", validationId: "validation-1" } }));
		expect(harness.transaction.skillAuthoringValidation.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: { taskId: "task-1", taskName: SkillAuthoringValidationTaskNames.Validate } }));
	});

	it("rejects a revision outside the authenticated silo before saving a task", async function _RejectsForeignRevision()
	{
		const harness = _Harness();
		harness.transaction.skillRevision.findFirst.mockResolvedValue(null);
		const authority = new PrismaSkillAuthoringValidationSubmissionRepository(harness.transaction as never, harness.workflow as never, harness.authorization as never);

		await expect(authority.submit({ siloId: "silo-a", principalId: "principal-1" }, "foreign-revision")).rejects.toThrow(/requires permission/);

		expect(harness.authorization.admitPrincipal).not.toHaveBeenCalled();
		expect(harness.workflow.spawn).not.toHaveBeenCalled();
		expect(harness.transaction.skillAuthoringValidation.upsert).not.toHaveBeenCalled();
	});

	it("rejects a current revision when the central review action is denied", async function _RejectsDeniedReview()
	{
		const harness = _Harness();
		harness.authorization.admitPrincipal.mockResolvedValue({ outcome: AuthorizationDecisionOutcomes.Deny });
		const authority = new PrismaSkillAuthoringValidationSubmissionRepository(harness.transaction as never, harness.workflow as never, harness.authorization as never);

		await expect(authority.submit({ siloId: "silo-a", principalId: "principal-1" }, "revision-1")).rejects.toThrow(/requires permission/);

		expect(harness.workflow.spawn).not.toHaveBeenCalled();
		expect(harness.transaction.skillAuthoringValidation.upsert).not.toHaveBeenCalled();
	});
});
