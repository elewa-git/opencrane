import { describe, expect, it, vi } from "vitest";

import { SkillAuthoringValidationTaskDeclaration } from "@opencrane/backend/agents/skills/workflows/contract";

import { __AdmitSkillAuthoringValidation, SkillAuthoringValidationAdmissionError, SkillAuthoringValidationAdmissionRejectionReasons } from "../index";
import type { SkillAuthoringValidationAdmissionCommand, SkillAuthoringValidationAdmissionTransaction, SkillAuthoringValidationRecord, SkillAuthoringValidationRepository } from "../index";

/** Returns fixed immutable coordinates for the one supported Python authoring validation. */
function _Command(): SkillAuthoringValidationAdmissionCommand
{
	return {
		siloId: "silo-1",
		skillRevisionId: "revision-1",
		artifactRevisionId: "artifact-revision-1",
		artifactContentAddress: `sha256:${"a".repeat(64)}`,
	};
}

/** Returns the record that the transaction-scoped repository may admit for the fixed command. */
function _Record(): SkillAuthoringValidationRecord
{
	return { validationId: "validation-1", siloId: "silo-1", skillRevisionId: "revision-1", artifactRevisionId: "artifact-revision-1", artifactContentAddress: `sha256:${"a".repeat(64)}`, taskKey: `sha256:${"b".repeat(64)}` };
}

/** Builds the transaction and remote engine fakes while preserving their call order for assertions. */
function _Context()
{
	const calls: string[] = [];
	const record = _Record();
	const workflowTransaction = { client: { transaction: "caller-owned" } };
	const createOrFind = vi.fn<SkillAuthoringValidationRepository["createOrFind"]>(async function _CreateOrFind() { calls.push("create-or-find"); return { record }; });
	const bindTask = vi.fn<SkillAuthoringValidationRepository["bindTask"]>(async function _BindTask() { calls.push("bind-task"); return "bound"; });
	const transaction = {
		workflowTransaction,
		validations: {
			createOrFind,
			bindTask,
		},
	} satisfies SkillAuthoringValidationAdmissionTransaction;
	const workflow = {
		spawn: vi.fn(async function _Spawn(receivedTransaction) { calls.push("spawn"); expect(receivedTransaction).toBe(workflowTransaction); return { taskId: "task-1", taskName: SkillAuthoringValidationTaskDeclaration.taskName, idempotencyKey: record.taskKey }; }),
	};
	return { bindTask, calls, createOrFind, record, transaction, workflow };
}

describe("skill authoring validation workflow admission", function _DescribeSkillAuthoringValidationWorkflow()
{
	it("creates or finds immutable facts, saves the remote task in the caller transaction, then binds its receipt", async function _AdmitsValidation()
	{
		const { calls, record, transaction, workflow } = _Context();

		await expect(__AdmitSkillAuthoringValidation(transaction, workflow as never, _Command())).resolves.toEqual({ validation: record, receipt: { taskId: "task-1", taskName: SkillAuthoringValidationTaskDeclaration.taskName, idempotencyKey: record.taskKey } });
		expect(calls).toEqual(["create-or-find", "spawn", "bind-task"]);
		expect(workflow.spawn).toHaveBeenCalledWith(transaction.workflowTransaction, { taskName: SkillAuthoringValidationTaskDeclaration.taskName, idempotencyKey: record.taskKey, input: { siloId: record.siloId, validationId: record.validationId } });
	});

	it("returns the same saved validation and task receipt when an exact retry is already bound", async function _ReplaysExactAdmission()
	{
		const { bindTask, record, transaction, workflow } = _Context();
		bindTask.mockResolvedValue("idempotent");

		const first = await __AdmitSkillAuthoringValidation(transaction, workflow as never, _Command());
		const retry = await __AdmitSkillAuthoringValidation(transaction, workflow as never, _Command());

		expect(retry).toEqual(first);
		expect(transaction.validations.createOrFind).toHaveBeenCalledTimes(2);
		expect(workflow.spawn).toHaveBeenCalledWith(transaction.workflowTransaction, expect.objectContaining({ idempotencyKey: record.taskKey }));
	});

	it.each(Object.values(SkillAuthoringValidationAdmissionRejectionReasons))("stops before task admission when the repository returns %s", async function _RejectsRepositoryReason(rejectionReason)
	{
		const { bindTask, createOrFind, transaction, workflow } = _Context();
		createOrFind.mockResolvedValue({ rejectionReason });

		await expect(__AdmitSkillAuthoringValidation(transaction, workflow as never, _Command())).rejects.toEqual(new SkillAuthoringValidationAdmissionError(`Skill authoring validation was denied: ${rejectionReason}.`));
		expect(workflow.spawn).not.toHaveBeenCalled();
		expect(bindTask).not.toHaveBeenCalled();
	});

	it("propagates a task-admission failure so the caller can roll back its transaction", async function _PropagatesSpawnFailure()
	{
		const { bindTask, transaction, workflow } = _Context();
		workflow.spawn.mockRejectedValue(new Error("workflow persistence unavailable"));

		await expect(__AdmitSkillAuthoringValidation(transaction, workflow as never, _Command())).rejects.toThrow("workflow persistence unavailable");
		expect(bindTask).not.toHaveBeenCalled();
	});

	it("rejects a conflicting saved task binding after the remote task receipt is returned", async function _RejectsBindingConflict()
	{
		const { bindTask, transaction, workflow } = _Context();
		bindTask.mockResolvedValue("conflict");

		await expect(__AdmitSkillAuthoringValidation(transaction, workflow as never, _Command())).rejects.toThrow("task binding conflicts");
	});
});
