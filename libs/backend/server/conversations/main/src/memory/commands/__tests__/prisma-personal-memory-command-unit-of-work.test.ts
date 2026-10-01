import { describe, expect, it, vi } from "vitest";

import { PersonalMemoryCommandDatasetStates, PersonalMemoryOperationAdmissionOutcomes, PersonalMemoryOperationKinds, PersonalMemoryOperationPhases, PrismaPersonalMemoryCommandContextRepository, PrismaPersonalMemoryOperationRepository } from "@opencrane/backend/agents/personal/memory";
import { PrismaAuthorizationAuthority, __DigestCanonicalJson } from "@opencrane/backend/server/iam/authorization";
import { AuthorizationDecisionOutcomes } from "@opencrane/models/authorization";

import { PrismaPersonalMemoryOperationActorRepository } from "../../workflow/prisma-personal-memory-operation-actor-repository";
import { PrismaPersonalMemoryMessageSourceRepository } from "../../source/prisma-personal-memory-message-source-repository";
import { PersonalMemoryCommandAdmissionOutcomes } from "../personal-memory-command-authority.types";
import { PrismaPersonalMemoryCommandUnitOfWork } from "../prisma-personal-memory-command-unit-of-work";

const _CALLER = { siloId: "silo-1", principalId: "principal-1", subjectId: "subject-1", externalIssuer: "https://issuer.test" } as const;
const _COMMAND_ID = "00000000-0000-4000-8000-000000000010";
const _OPERATION_ID = "00000000-0000-4000-8000-000000000011";
const _DATASET_PROVIDER_ID = "00000000-0000-4000-8000-000000000012";
const _TASK_ID = "00000000-0000-4000-8000-000000000013";
const _SOURCE = { source: { conversationId: "conversation-1", messageId: "message-1", messagePosition: 7n, payloadRef: "payload-1", ciphertextDigest: `sha256:${"b".repeat(64)}`, authorPrincipalId: _CALLER.principalId }, text: "private source", contentDigest: `sha256:${"c".repeat(64)}` } as const;
const _REMEMBER = { commandId: _COMMAND_ID, kind: PersonalMemoryOperationKinds.Remember, source: { conversationId: "conversation-1", messageId: "message-1", messagePosition: "7" } } as const;

describe("PrismaPersonalMemoryCommandUnitOfWork", function _Suite()
{
	it("binds the audit digest to the saved command and commits one identifier-only task", async function _FreshAdmission()
	{
		const fixture = _Fixture();
		const operation = _Operation();
		vi.spyOn(PrismaPersonalMemoryOperationRepository.prototype, "findByReplayKey").mockResolvedValue(null);
		vi.spyOn(PrismaPersonalMemoryCommandContextRepository.prototype, "findDataset").mockResolvedValue({ id: "dataset-1", state: PersonalMemoryCommandDatasetStates.Active, cogneeDatasetId: _DATASET_PROVIDER_ID });
		vi.spyOn(PrismaPersonalMemoryMessageSourceRepository.prototype, "revalidate").mockResolvedValue(true);
		const admitOperation = vi.spyOn(PrismaPersonalMemoryOperationRepository.prototype, "admit").mockImplementation(async function _Admit(command, admitTask)
		{
			const task = await admitTask(command.task);
			return { outcome: PersonalMemoryOperationAdmissionOutcomes.Created, operation: { ...operation, commandDigest: command.commandDigest, task } } as never;
		});

		const result = await fixture.authority.admit(_CALLER, _REMEMBER);

		expect(result).toMatchObject({ outcome: PersonalMemoryCommandAdmissionOutcomes.Accepted, receipt: { operationId: _OPERATION_ID } });
		expect(fixture.admitPrincipal).toHaveBeenCalledOnce();
		const argumentsDigest = fixture.admitPrincipal.mock.calls[0]![0].argumentsDigest;
		expect(admitOperation.mock.calls[0]![0].commandDigest).toBe(argumentsDigest);
		expect(fixture.spawn).toHaveBeenCalledWith({ client: fixture.transaction }, { taskName: "personal-memory-operation", idempotencyKey: _OPERATION_ID, input: { siloId: "silo-1", operationId: _OPERATION_ID } });
		expect(JSON.stringify(fixture.spawn.mock.calls)).not.toContain(_SOURCE.text);
	});

	it("replays the saved operation after current checks without another audit or task", async function _Replay()
	{
		const fixture = _Fixture();
		const first = vi.spyOn(PrismaPersonalMemoryOperationRepository.prototype, "findByReplayKey").mockResolvedValue(_Operation() as never);
		vi.spyOn(PrismaPersonalMemoryCommandContextRepository.prototype, "findDataset").mockResolvedValue({ id: "dataset-1", state: PersonalMemoryCommandDatasetStates.Active, cogneeDatasetId: _DATASET_PROVIDER_ID });
		vi.spyOn(PrismaPersonalMemoryMessageSourceRepository.prototype, "revalidate").mockResolvedValue(true);
		const admitOperation = vi.spyOn(PrismaPersonalMemoryOperationRepository.prototype, "admit");

		const result = await fixture.authority.admit(_CALLER, _REMEMBER);

		expect(first).toHaveBeenCalledOnce();
		expect(result).toMatchObject({ outcome: PersonalMemoryCommandAdmissionOutcomes.Idempotent, receipt: { operationId: _OPERATION_ID } });
		expect(fixture.decidePrincipal).toHaveBeenCalledOnce();
		expect(fixture.admitPrincipal).not.toHaveBeenCalled();
		expect(admitOperation).not.toHaveBeenCalled();
		expect(fixture.spawn).not.toHaveBeenCalled();
	});

	it("returns unavailable before audit or task admission when source authority ended", async function _SourceEnded()
	{
		const fixture = _Fixture();
		vi.spyOn(PrismaPersonalMemoryOperationRepository.prototype, "findByReplayKey").mockResolvedValue(null);
		vi.spyOn(PrismaPersonalMemoryCommandContextRepository.prototype, "findDataset").mockResolvedValue({ id: "dataset-1", state: PersonalMemoryCommandDatasetStates.Active, cogneeDatasetId: _DATASET_PROVIDER_ID });
		vi.spyOn(PrismaPersonalMemoryMessageSourceRepository.prototype, "revalidate").mockResolvedValue(false);
		const admitOperation = vi.spyOn(PrismaPersonalMemoryOperationRepository.prototype, "admit");

		await expect(fixture.authority.admit(_CALLER, _REMEMBER)).resolves.toBeNull();
		expect(fixture.admitPrincipal).not.toHaveBeenCalled();
		expect(admitOperation).not.toHaveBeenCalled();
		expect(fixture.spawn).not.toHaveBeenCalled();
	});
});

/** Creates transaction-bound collaborators while replacing only their observable port methods. */
function _Fixture()
{
	vi.restoreAllMocks();
	const transaction = {};
	const prisma = { $transaction: vi.fn(async function _Transaction(work) { return work(transaction); }) };
	const sources = { read: vi.fn().mockResolvedValue(_SOURCE) };
	const spawn = vi.fn().mockResolvedValue({ taskId: _TASK_ID, taskName: "personal-memory-operation", idempotencyKey: _OPERATION_ID });
	vi.spyOn(PrismaPersonalMemoryOperationActorRepository.prototype, "resolve").mockResolvedValue(_CALLER);
	const admitPrincipal = vi.spyOn(PrismaAuthorizationAuthority.prototype, "admitPrincipal").mockResolvedValue({ outcome: AuthorizationDecisionOutcomes.Allow, reason: "grant_allowed", evidence: { decisionDigest: `sha256:${"d".repeat(64)}`, policyRevisionHash: `sha256:${"e".repeat(64)}`, effectiveAuthorizationDigest: `sha256:${"f".repeat(64)}` } } as never);
	const decidePrincipal = vi.spyOn(PrismaAuthorizationAuthority.prototype, "decidePrincipal").mockResolvedValue({ outcome: AuthorizationDecisionOutcomes.Allow, reason: "grant_allowed" } as never);
	const authority = new PrismaPersonalMemoryCommandUnitOfWork(prisma as never, sources, { spawn } as never, () => new Date("2026-09-14T08:00:00.000Z"), () => _OPERATION_ID);
	return { authority, transaction, spawn, admitPrincipal, decidePrincipal };
}

/** Returns the exact operation projection used by replay and receipt mapping. */
function _Operation()
{
	const commandDigest = __DigestCanonicalJson({ siloId: _CALLER.siloId, actorPrincipalId: _CALLER.principalId, command: _REMEMBER, datasetId: "dataset-1", providerDatasetId: _DATASET_PROVIDER_ID, source: { ..._SOURCE.source, messagePosition: "7", contentDigest: _SOURCE.contentDigest }, targetDocumentId: null } as never);
	return { operationId: _OPERATION_ID, siloId: "silo-1", datasetId: "dataset-1", actorPrincipalId: _CALLER.principalId, idempotencyKeyDigest: `sha256:${"a".repeat(64)}`, commandDigest, kind: PersonalMemoryOperationKinds.Remember, phase: PersonalMemoryOperationPhases.DocumentAddPending, recoveryPhase: null, revision: 1, expectedContentDigest: _SOURCE.contentDigest, targetFactId: null, targetDocumentId: null, expectedFactRevision: null, admittedProviderDatasetId: _DATASET_PROVIDER_ID, providerDatasetId: _DATASET_PROVIDER_ID, documentId: null, indexingOperationId: null, expectedInputEvidenceDigest: null, pipelineRunId: null, failureCode: null, deliveryState: null, source: _SOURCE.source, task: { taskId: _TASK_ID, taskName: "personal-memory-operation", taskKey: _OPERATION_ID }, admittedAt: new Date("2026-09-14T08:00:00.000Z"), recoveryRecordedAt: null, completedAt: null };
}
