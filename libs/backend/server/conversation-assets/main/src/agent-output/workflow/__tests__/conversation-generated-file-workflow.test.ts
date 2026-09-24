import { createHash } from "node:crypto";

import { WorkflowTaskRetryableError, WorkflowTaskTerminalError, type IWorkflowCheckpointOperation, type IWorkflowEngine, type IWorkflowTaskContext, type IWorkflowTaskDefinition, type IWorkflowTaskReceipt } from "@opencrane/backend/server/infra/workflows/contract";
import { ___GeneratedFileEventName } from "@opencrane/contracts";
import { describe, expect, it, vi } from "vitest";

import { CONVERSATION_GENERATED_FILE_TASK } from "../../persistence/conversation-generated-file-task";
import type { ConversationGeneratedFileTaskInput } from "../../persistence/generated-file-capture.types";
import { _RegisterConversationGeneratedFileWorkflow } from "../conversation-generated-file-workflow";
import { ConversationGeneratedFileWorkflowOutcomes, GeneratedFileQuarantineOutcomes, GeneratedFileWorkflowStates, type ConversationGeneratedFileWorkflowDependencies, type ConversationGeneratedFileWorkflowResult, type GeneratedFilePromotionReceipt, type GeneratedFileWorkflowSnapshot } from "../generated-file-workflow.types";

/** Stable plaintext used by every promotion and digest assertion. */
const _CONTENT = new TextEncoder().encode("name,value\r\nalpha,1\r\n");
/** Full immutable address for the stable plaintext. */
const _CONTENT_ADDRESS = `sha256:${createHash("sha256").update(_CONTENT).digest("hex")}`;
/** Identifier-only task input captured in the original transaction. */
const _INPUT: ConversationGeneratedFileTaskInput = { siloId: "silo-1", operationId: "operation-1" };
/** Exact task receipt that the persistence port must revalidate on every call. */
const _TASK: IWorkflowTaskReceipt = { taskId: "task-1", taskName: CONVERSATION_GENERATED_FILE_TASK.taskName, idempotencyKey: "operation-key-1" };

/** Mutable test harness exposing the registered runner and narrow dependency calls. */
interface _Harness
{
	/** Context passed to the registered task handler. */
	readonly context: IWorkflowTaskContext;
	/** Persistence dependency observed by tests. */
	readonly persistence: {
		/** Reload current operation and authority. */
		readonly loadCurrent: ReturnType<typeof vi.fn>;
		/** Open exact verified custody bytes. */
		readonly openVerifiedBytes: ReturnType<typeof vi.fn>;
		/** Admit the promotion receipt to quarantine. */
		readonly finalizeQuarantine: ReturnType<typeof vi.fn>;
	};
	/** External promotion call observed by tests. */
	readonly promote: ReturnType<typeof vi.fn>;
	/** Invoke the exact handler registered with the workflow engine. */
	run(): Promise<ConversationGeneratedFileWorkflowResult>;
}

/** Return one valid current operation in a selected derived state. */
function _Snapshot(state: GeneratedFileWorkflowStates): GeneratedFileWorkflowSnapshot
{
	return { siloId: _INPUT.siloId, operationId: _INPUT.operationId, artifactId: "artifact-1", artifactRevisionId: "revision-1", uploadLeaseId: "upload-lease-1", contentAddress: _CONTENT_ADDRESS, byteLength: _CONTENT.byteLength, mediaType: "text/csv;charset=utf-8", notAfterEpochMs: Date.now() + 60_000, state };
}

/** Return the only promotion receipt accepted for the valid snapshot. */
function _Receipt(overrides: Partial<GeneratedFilePromotionReceipt> = {}): GeneratedFilePromotionReceipt
{
	return { leaseId: "upload-lease-1", contentAddress: _CONTENT_ADDRESS, byteLength: _CONTENT.byteLength, mediaType: "text/csv;charset=utf-8", receiptDigest: `sha256:${"b".repeat(64)}`, ...overrides };
}

/** Register the workflow against synthetic ports and return its captured handler. */
function _HarnessFor(states: readonly (GeneratedFileWorkflowSnapshot | null)[], checkpointReceipt?: GeneratedFilePromotionReceipt): _Harness
{
	let definition: IWorkflowTaskDefinition<ConversationGeneratedFileTaskInput, ConversationGeneratedFileWorkflowResult> | undefined;
	const workflows = { register: vi.fn(function _Register(value: IWorkflowTaskDefinition<ConversationGeneratedFileTaskInput, ConversationGeneratedFileWorkflowResult>) { definition = value; }) } as unknown as IWorkflowEngine;
	const persistence = {
		loadCurrent: vi.fn(),
		openVerifiedBytes: vi.fn().mockResolvedValue(_CONTENT),
		finalizeQuarantine: vi.fn().mockResolvedValue(GeneratedFileQuarantineOutcomes.Advanced),
	};
	for (const state of states)
		persistence.loadCurrent.mockResolvedValueOnce(state);
	const promote = vi.fn().mockResolvedValue(_Receipt());
	const dependencies = { persistence, promotion: { promote } } as unknown as ConversationGeneratedFileWorkflowDependencies;
	_RegisterConversationGeneratedFileWorkflow(workflows, dependencies);
	const context = _Context(checkpointReceipt);
	return {
		context,
		persistence,
		promote,
		async run(): Promise<ConversationGeneratedFileWorkflowResult>
		{
			if (definition === undefined)
				throw new Error("Generated file workflow was not registered");
			return definition.run(context, _INPUT);
		},
	};
}

/** Build a deterministic workflow context with observable checkpoint and event boundaries. */
function _Context(checkpointReceipt?: GeneratedFilePromotionReceipt): IWorkflowTaskContext
{
	return {
		task: _TASK,
		attempt: 1,
		async checkpoint<TResult>(_step: { readonly stepName: string }, operation: IWorkflowCheckpointOperation<TResult>): Promise<TResult>
		{
			if (checkpointReceipt !== undefined)
				return checkpointReceipt as TResult;
			return operation();
		},
		waitForEvent: vi.fn().mockResolvedValue({ eventName: ___GeneratedFileEventName(_INPUT.operationId), payload: {} }),
		spawnChild: vi.fn(),
		awaitChild: vi.fn(),
		sleepUntil: vi.fn(),
	};
}

describe("conversation generated file workflow", function _Suite()
{
	it("promotes verified custody once, admits quarantine, waits for scanning and reloads Ready", async function _PromotesAndWaits()
	{
		const harness = _HarnessFor([_Snapshot(GeneratedFileWorkflowStates.PromotionRequired), _Snapshot(GeneratedFileWorkflowStates.ScanPending), _Snapshot(GeneratedFileWorkflowStates.Ready)]);

		await expect(harness.run()).resolves.toEqual({ operationId: _INPUT.operationId, outcome: ConversationGeneratedFileWorkflowOutcomes.Ready });

		expect(harness.persistence.loadCurrent).toHaveBeenCalledTimes(3);
		expect(harness.persistence.openVerifiedBytes).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ state: GeneratedFileWorkflowStates.PromotionRequired }), _TASK, expect.any(Date));
		expect(harness.promote).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ operationId: _INPUT.operationId, uploadLeaseId: "upload-lease-1", content: _CONTENT }));
		expect(harness.persistence.finalizeQuarantine).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ operationId: _INPUT.operationId }), _TASK, _Receipt(), expect.any(Date));
		expect(harness.context.waitForEvent).toHaveBeenCalledExactlyOnceWith(___GeneratedFileEventName(_INPUT.operationId), { timeoutAt: expect.any(Date) });
		expect(harness.promote.mock.invocationCallOrder[0]).toBeLessThan(harness.persistence.finalizeQuarantine.mock.invocationCallOrder[0]!);
		expect(harness.persistence.finalizeQuarantine.mock.invocationCallOrder[0]).toBeLessThan((harness.context.waitForEvent as unknown as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0]!);
	});

	it("uses a saved metadata receipt after checkpoint recovery without repeating promotion", async function _RecoversPromotion()
	{
		const harness = _HarnessFor([_Snapshot(GeneratedFileWorkflowStates.PromotionRequired), _Snapshot(GeneratedFileWorkflowStates.ScanPending), _Snapshot(GeneratedFileWorkflowStates.Ready)], _Receipt());

		await expect(harness.run()).resolves.toMatchObject({ outcome: ConversationGeneratedFileWorkflowOutcomes.Ready });

		expect(harness.promote).not.toHaveBeenCalled();
		expect(harness.persistence.finalizeQuarantine).toHaveBeenCalledOnce();
	});

	it("resumes a scan wait without reopening custody or promoting bytes", async function _ResumesScanWait()
	{
		const harness = _HarnessFor([_Snapshot(GeneratedFileWorkflowStates.ScanPending), _Snapshot(GeneratedFileWorkflowStates.Failed)]);

		await expect(harness.run()).resolves.toEqual({ operationId: _INPUT.operationId, outcome: ConversationGeneratedFileWorkflowOutcomes.Failed });

		expect(harness.persistence.openVerifiedBytes).not.toHaveBeenCalled();
		expect(harness.promote).not.toHaveBeenCalled();
		expect(harness.context.waitForEvent).toHaveBeenCalledOnce();
	});

	it("treats an event timeout only as a reason to reload current authority", async function _ReloadsAfterTimeout()
	{
		const harness = _HarnessFor([_Snapshot(GeneratedFileWorkflowStates.ScanPending), null]);
		const waitForEvent = harness.context.waitForEvent as unknown as ReturnType<typeof vi.fn>;
		waitForEvent.mockResolvedValue({ eventName: ___GeneratedFileEventName(_INPUT.operationId), payload: null, timedOut: true });

		await expect(harness.run()).resolves.toEqual({ operationId: _INPUT.operationId, outcome: ConversationGeneratedFileWorkflowOutcomes.AuthorityEnded });

		expect(harness.persistence.loadCurrent).toHaveBeenCalledTimes(2);
		expect(harness.promote).not.toHaveBeenCalled();
	});

	it("returns an authority-ended result without touching custody or Artifact storage", async function _AuthorityEnded()
	{
		const harness = _HarnessFor([null]);

		await expect(harness.run()).resolves.toEqual({ operationId: _INPUT.operationId, outcome: ConversationGeneratedFileWorkflowOutcomes.AuthorityEnded });

		expect(harness.persistence.openVerifiedBytes).not.toHaveBeenCalled();
		expect(harness.promote).not.toHaveBeenCalled();
		expect(harness.persistence.finalizeQuarantine).not.toHaveBeenCalled();
	});

	it.each([
		[GeneratedFileWorkflowStates.Ready, ConversationGeneratedFileWorkflowOutcomes.Ready],
		[GeneratedFileWorkflowStates.Failed, ConversationGeneratedFileWorkflowOutcomes.Failed],
	])("recovers saved %s after the original execution deadline", async function _RecoversExpiredTerminal(state, outcome)
	{
		const snapshot = { ..._Snapshot(state), notAfterEpochMs: Date.now() - 60_000 };
		const harness = _HarnessFor([snapshot]);

		await expect(harness.run()).resolves.toEqual({ operationId: _INPUT.operationId, outcome });

		expect(harness.persistence.openVerifiedBytes).not.toHaveBeenCalled();
		expect(harness.promote).not.toHaveBeenCalled();
		expect(harness.persistence.finalizeQuarantine).not.toHaveBeenCalled();
		expect(harness.context.waitForEvent).not.toHaveBeenCalled();
	});

	it.each([GeneratedFileWorkflowStates.PromotionRequired, GeneratedFileWorkflowStates.ScanPending])("rejects expired %s before doing further work", async function _RejectsExpiredWork(state)
	{
		const snapshot = { ..._Snapshot(state), notAfterEpochMs: Date.now() - 60_000 };
		const harness = _HarnessFor([snapshot]);

		await expect(harness.run()).rejects.toBeInstanceOf(WorkflowTaskTerminalError);

		expect(harness.persistence.openVerifiedBytes).not.toHaveBeenCalled();
		expect(harness.promote).not.toHaveBeenCalled();
		expect(harness.persistence.finalizeQuarantine).not.toHaveBeenCalled();
		expect(harness.context.waitForEvent).not.toHaveBeenCalled();
	});

	it("rejects substituted plaintext before the promotion checkpoint", async function _RejectsSubstitutedBytes()
	{
		const harness = _HarnessFor([_Snapshot(GeneratedFileWorkflowStates.PromotionRequired)]);
		harness.persistence.openVerifiedBytes.mockResolvedValue(new TextEncoder().encode("different bytes"));

		await expect(harness.run()).rejects.toBeInstanceOf(WorkflowTaskTerminalError);

		expect(harness.promote).not.toHaveBeenCalled();
		expect(harness.persistence.finalizeQuarantine).not.toHaveBeenCalled();
	});

	it("rejects a recovered receipt for different bytes before quarantine admission", async function _RejectsForeignReceipt()
	{
		const harness = _HarnessFor([_Snapshot(GeneratedFileWorkflowStates.PromotionRequired)], _Receipt({ contentAddress: `sha256:${"c".repeat(64)}` }));

		await expect(harness.run()).rejects.toBeInstanceOf(WorkflowTaskTerminalError);

		expect(harness.promote).not.toHaveBeenCalled();
		expect(harness.persistence.finalizeQuarantine).not.toHaveBeenCalled();
	});

	it("leaves an unavailable promotion to the declared Absurd retry policy", async function _RetriesPromotion()
	{
		const harness = _HarnessFor([_Snapshot(GeneratedFileWorkflowStates.PromotionRequired)]);
		harness.promote.mockRejectedValue(new Error("offline"));

		await expect(harness.run()).rejects.toBeInstanceOf(WorkflowTaskRetryableError);

		expect(harness.persistence.finalizeQuarantine).not.toHaveBeenCalled();
	});

	it("reloads after an idempotent quarantine winner instead of repeating the external effect", async function _AcceptsConcurrentWinner()
	{
		const harness = _HarnessFor([_Snapshot(GeneratedFileWorkflowStates.PromotionRequired), _Snapshot(GeneratedFileWorkflowStates.Ready)]);
		harness.persistence.finalizeQuarantine.mockResolvedValue(GeneratedFileQuarantineOutcomes.Idempotent);

		await expect(harness.run()).resolves.toMatchObject({ outcome: ConversationGeneratedFileWorkflowOutcomes.Ready });

		expect(harness.promote).toHaveBeenCalledOnce();
		expect(harness.persistence.loadCurrent).toHaveBeenCalledTimes(2);
	});
});
