import { SkillRevisionState, SkillTrustClass } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import { SkillAuthoringValidationAdmissionRejectionReasons } from "@opencrane/backend/agents/skills/workflows";

import { PrismaSkillAuthoringValidationRepository } from "../prisma-skill-authoring-validation-repository";

/** Return one immutable command suitable for the authoring validation admission boundary. */
function _Command(): { readonly siloId: string; readonly skillRevisionId: string; readonly artifactRevisionId: string; readonly artifactContentAddress: string }
{
	return {
		siloId: "silo-1",
		skillRevisionId: "skill-revision-1",
		artifactRevisionId: "artifact-revision-1",
		artifactContentAddress: `sha256:${"a".repeat(64)}`,
	};
}

/** Return the Prisma shape that proves this Draft Python revision owns the requested artifact. */
function _Revision(command = _Command()): { readonly skill: { readonly siloId: string }; readonly state: SkillRevisionState; readonly trustClass: SkillTrustClass; readonly artifactRevisionId: string; readonly artifactContentAddress: string }
{
	return {
		skill: { siloId: command.siloId },
		state: SkillRevisionState.Draft,
		trustClass: SkillTrustClass.SandboxedPython,
		artifactRevisionId: command.artifactRevisionId,
		artifactContentAddress: command.artifactContentAddress,
	};
}

/** Return one stored validation projection with no task receipt yet bound. */
function _Validation(command = _Command()): { readonly id: string; readonly siloId: string; readonly skillRevisionId: string; readonly artifactRevisionId: string; readonly artifactContentAddress: string; readonly taskId: string | null; readonly taskName: string | null; readonly taskKey: string }
{
	return {
		id: "validation-1",
		siloId: command.siloId,
		skillRevisionId: command.skillRevisionId,
		artifactRevisionId: command.artifactRevisionId,
		artifactContentAddress: command.artifactContentAddress,
		taskId: null,
		taskName: null,
		taskKey: `workflows:skill-authoring-validation:${"b".repeat(64)}`,
	};
}

/** Build a repository with independent spies for each Prisma capability it owns. */
function _Harness(): { readonly repository: PrismaSkillAuthoringValidationRepository; readonly skillRevisionFindUnique: ReturnType<typeof vi.fn>; readonly artifactRevisionFindFirst: ReturnType<typeof vi.fn>; readonly validationFindUnique: ReturnType<typeof vi.fn>; readonly validationUpsert: ReturnType<typeof vi.fn>; readonly validationUpdateMany: ReturnType<typeof vi.fn> }
{
	const skillRevisionFindUnique = vi.fn().mockResolvedValue(_Revision());
	const artifactRevisionFindFirst = vi.fn().mockResolvedValue({ id: "artifact-revision-1" });
	const validationFindUnique = vi.fn().mockResolvedValue(null);
	const validationUpsert = vi.fn().mockImplementation(async function _Upsert(input: { readonly create: Record<string, string> })
	{
		return { ..._Validation(), taskKey: input.create["taskKey"] };
	});
	const validationUpdateMany = vi.fn().mockResolvedValue({ count: 1 });
	const transaction = {
		skillRevision: { findUnique: skillRevisionFindUnique },
		artifactRevision: { findFirst: artifactRevisionFindFirst },
		skillAuthoringValidation: {
			findUnique: validationFindUnique,
			upsert: validationUpsert,
			updateMany: validationUpdateMany,
		},
	};
	return {
		repository: new PrismaSkillAuthoringValidationRepository(transaction as never),
		skillRevisionFindUnique,
		artifactRevisionFindFirst,
		validationFindUnique,
		validationUpsert,
		validationUpdateMany,
	};
}

describe("Prisma skill authoring validation repository", function _DescribePrismaSkillAuthoringValidationRepository()
{
	it("creates one task-keyed validation only after it rechecks the draft Python artifact", async function _Creates()
	{
		const harness = _Harness();
		const command = _Command();

		const resolution = await harness.repository.createOrFind(command);

		expect(resolution.record).toMatchObject({ validationId: "validation-1", ...command, taskKey: expect.stringMatching(/^workflows:skill-authoring-validation:[a-f0-9]{64}$/u) });
		expect(harness.artifactRevisionFindFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ id: command.artifactRevisionId, contentAddress: command.artifactContentAddress }) }));
		expect(harness.validationUpsert).toHaveBeenCalledWith(expect.objectContaining({ create: expect.objectContaining({ ...command, taskKey: resolution.record?.taskKey }), update: {} }));
	});

	it("rejects a revision outside the requested silo before it looks for an artifact or a prior validation", async function _RejectsForeignSilo()
	{
		const harness = _Harness();
		harness.skillRevisionFindUnique.mockResolvedValue({ ..._Revision(), skill: { siloId: "silo-2" } });

		const resolution = await harness.repository.createOrFind(_Command());

		expect(resolution).toEqual({ rejectionReason: SkillAuthoringValidationAdmissionRejectionReasons.ForeignSilo });
		expect(harness.artifactRevisionFindFirst).not.toHaveBeenCalled();
		expect(harness.validationFindUnique).not.toHaveBeenCalled();
	});

	it("binds a task receipt once after the same database transaction saved it through Absurd", async function _BindsTask()
	{
		const harness = _Harness();
		const stored = { ..._Validation(), taskKey: `workflows:skill-authoring-validation:${"c".repeat(64)}` };
		const record = { validationId: stored.id, siloId: stored.siloId, skillRevisionId: stored.skillRevisionId, artifactRevisionId: stored.artifactRevisionId, artifactContentAddress: stored.artifactContentAddress, taskKey: stored.taskKey };
		harness.validationFindUnique.mockResolvedValue(stored);

		const outcome = await harness.repository.bindTask(record, { taskId: "task-1", taskName: "skills.authoring.validate/v1", idempotencyKey: record.taskKey });

		expect(outcome).toBe("bound");
		expect(harness.validationUpdateMany).toHaveBeenCalledWith({
			where: { id: stored.id, taskId: null, taskName: null, taskKey: record.taskKey },
			data: { taskId: "task-1", taskName: "skills.authoring.validate/v1" },
		});
	});
});
