import { describe, expect, it, vi } from "vitest";

import { ArtifactPreprocessTaskDeclaration } from "@opencrane/backend/artifacts/preprocessor/workflows/contract";

import { __AdmitArtifactPreprocessWorkflow, ArtifactPreprocessWorkflowAdmissionError } from "../index";

/** Returns immutable task facts for one published PDF. */
function _Record()
{
	return { preprocessJobId: "job-1", siloId: "silo-1", taskKey: "artifact-preprocess:job-1" };
}

describe("artifact preprocess workflow admission", function _DescribeArtifactPreprocessWorkflowAdmission()
{
	it("saves the declared identifier-only task in the supplied product transaction", async function _AdmitsTask()
	{
		const workflowTransaction = { client: {} };
		const spawn = vi.fn(async function _Spawn(receivedTransaction, input)
		{
			expect(receivedTransaction).toBe(workflowTransaction);
			expect(input).toEqual({ taskName: ArtifactPreprocessTaskDeclaration.taskName, idempotencyKey: "artifact-preprocess:job-1", input: { siloId: "silo-1", preprocessJobId: "job-1" } });
			return { taskId: "task-1", taskName: ArtifactPreprocessTaskDeclaration.taskName, idempotencyKey: "artifact-preprocess:job-1" };
		});

		await expect(__AdmitArtifactPreprocessWorkflow({ workflowTransaction }, { spawn } as never, _Record())).resolves.toEqual({ preprocess: _Record(), receipt: { taskId: "task-1", taskName: ArtifactPreprocessTaskDeclaration.taskName, idempotencyKey: "artifact-preprocess:job-1" } });
	});

	it("rejects a conflicting saved-task receipt before the product transaction can commit", async function _RejectsConflictingReceipt()
	{
		await expect(__AdmitArtifactPreprocessWorkflow({ workflowTransaction: { client: {} } }, { spawn: vi.fn(async function _Spawn() { return { taskId: "task-1", taskName: "other", idempotencyKey: "artifact-preprocess:job-1" }; }) } as never, _Record())).rejects.toEqual(new ArtifactPreprocessWorkflowAdmissionError("Artifact preprocessing workflow returned a conflicting task receipt."));
	});
});
