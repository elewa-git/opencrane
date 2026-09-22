import { afterEach, describe, expect, it, vi } from "vitest";

import { CompiledFinalOutputModes, ConversationEntryKinds, ConversationMessageContentBlockKinds, ConversationModelResponseKinds, ConversationModelToolModes, type ArtifactMessageContentBlock } from "@opencrane/contracts";

import { ConversationGeneratedFileResultStates } from "../../tools/results/conversation-generated-file-result.types";
import { ConversationComputerToolResultOutcomes } from "../conversation-computer-continuation.types";
import { _ToolContinuationHarness } from "./conversation-tool-continuation.fixture";
import { _ConversationComputerOutputIntents } from "../output/conversation-computer-output-receipt";
import { _StructuredInventoryResult } from "../output/__tests__/conversation-structured-output.fixture";

afterEach(function _RestoreClock() { vi.restoreAllMocks(); });

/** Adds a display to final model text while preserving the existing tool and artifact progression. */
async function _generatedFileHarness(finalOutput: CompiledFinalOutputModes)
{
	const f = await _ToolContinuationHarness(1, 100, function _FinalMode(candidate)
	{
		Object.assign(candidate, { compiledInput: { ...candidate.compiledInput, finalOutput } });
	});
	const request = f.model.request.getMockImplementation()!;
	f.model.request.mockImplementation(async function _FinalDisplay(input)
	{
		const response = await request(input);
		if (finalOutput === CompiledFinalOutputModes.Conversation && response.kind === ConversationModelResponseKinds.Text)
			return { ...response, display: _StructuredInventoryResult() };
		return response;
	});
	const complete = f.runLifecycle.complete.getMockImplementation()!;
	f.runLifecycle.complete.mockImplementation(async function _CompleteAfterExactHistory()
	{
		const receipt = (await f.store.load(f.step))!.protocol.output!.receipt;
		const intents = _ConversationComputerOutputIntents(receipt);
		expect(intents.map(intent => intent.event.data.entry.kind)).toEqual(finalOutput === CompiledFinalOutputModes.Conversation ? [ConversationEntryKinds.Message, ConversationEntryKinds.A2UI] : [ConversationEntryKinds.Message]);
		expect(f.history.streams.get(f.stream)!.slice(2).map(event => event.data)).toEqual(intents.map(intent => intent.event.data));
		await complete();
	});
	return f;
}

describe("generated file continuation", function _GeneratedFileContinuation()
{
	it.each([CompiledFinalOutputModes.Text, CompiledFinalOutputModes.Conversation])("recovers a saved %s answer and attachment after its SQL link fails without another model call", async function _RecoverAttachment(finalOutput)
	{
		const f = await _generatedFileHarness(finalOutput);
		const read = f.results.read.getMockImplementation()!;
		const artifact: ArtifactMessageContentBlock = { id: "asset-1", kind: ConversationMessageContentBlockKinds.Artifact, artifactId: "artifact-1", artifactRevisionId: "revision-1", name: "counties.csv", mediaType: "text/csv;charset=utf-8" };
		f.results.read.mockImplementation(async function _FileResult(turn)
		{
			const result = await read(turn);
			if (result.outcome !== ConversationComputerToolResultOutcomes.Available)
				return result;
			return { ...result, generatedFile: { state: ConversationGeneratedFileResultStates.Ready, operationId: "file-operation", artifact } };
		});
		f.fileLinks.link.mockRejectedValueOnce(new Error("SQL link response lost"));
		expect(await f.authority.advance(f.step)).toEqual({ outcome: "retry" });
		expect(f.runLifecycle.enterRecoveryRequired).not.toHaveBeenCalled();
		const saved = (await f.store.load(f.step))!;
		expect(saved.protocol.output!.receipt!.event.data.entry).toMatchObject({ blocks: [{ kind: "text" }, artifact] });
		expect(f.flags.runState).toBe("running");
		expect(f.runLifecycle.complete).not.toHaveBeenCalled();
		expect(f.model.request).toHaveBeenCalledTimes(2);
		expect(await f.restart().advance(f.step)).toEqual({ outcome: "completed" });
		expect(f.fileLinks.link).toHaveBeenCalledTimes(2);
		expect(f.flags.runState).toBe("completed");
		expect((await f.store.load(f.step))!.protocol.output?.receipt).toEqual(saved.protocol.output!.receipt);
		expect(f.history.streams.get(f.stream)).toHaveLength(finalOutput === CompiledFinalOutputModes.Conversation ? 4 : 3);
		expect(f.model.request).toHaveBeenCalledTimes(2);
		expect(f.toolFlags).toMatchObject({ executions: 1, acknowledgements: 1 });
		expect(f.flags.payloadWrites).toBe(1);
	});

	it.each([CompiledFinalOutputModes.Text, CompiledFinalOutputModes.Conversation])("settles an already-linked %s answer after lease expiry without creating another output", async function _LinkedRecoveryAfterExpiry(finalOutput)
	{
		const f = await _generatedFileHarness(finalOutput);
		const read = f.results.read.getMockImplementation()!;
		f.results.read.mockImplementation(async function _FileResult(turn)
		{
			const result = await read(turn);
			if (result.outcome !== ConversationComputerToolResultOutcomes.Available)
				return result;
			return { ...result, generatedFile: { state: ConversationGeneratedFileResultStates.Ready, operationId: "file-operation", artifact: { id: "asset-1", kind: ConversationMessageContentBlockKinds.Artifact, artifactId: "artifact-1", artifactRevisionId: "revision-1", name: "counties.csv", mediaType: "text/csv;charset=utf-8" } } };
		});
		f.runLifecycle.complete.mockRejectedValueOnce(new Error("run completion interrupted"));
		expect(await f.authority.advance(f.step)).toEqual({ outcome: "retry" });
		expect(f.runLifecycle.enterRecoveryRequired).not.toHaveBeenCalled();
		expect(f.fileLinks.link).toHaveBeenCalledOnce();
		const saved = (await f.store.load(f.step))!.protocol.output?.receipt;
		expect(saved!.event.data.entry).toMatchObject({ kind: ConversationEntryKinds.Message, blocks: [{ kind: ConversationMessageContentBlockKinds.Text }, { kind: ConversationMessageContentBlockKinds.Artifact, artifactRevisionId: "revision-1" }] });
		f.current.lease.expiresAt = "2000-01-01T00:00:00.000Z";
		expect(await f.restart().advance(f.step)).toEqual({ outcome: "completed" });
		expect(f.fileLinks.link).toHaveBeenCalledTimes(2);
		expect(f.flags.runState).toBe("completed");
		expect((await f.store.load(f.step))!.protocol.output?.receipt).toEqual(saved);
		expect(f.history.streams.get(f.stream)).toHaveLength(finalOutput === CompiledFinalOutputModes.Conversation ? 4 : 3);
		expect(f.model.request).toHaveBeenCalledTimes(2);
		expect(f.toolFlags).toMatchObject({ executions: 1, acknowledgements: 1 });
		expect(f.flags.payloadWrites).toBe(1);
	});

	it("waits across restart without dispatching again or replenishing the original allowance", async function _WaitAndContinue()
	{
		let now = Date.now();
		vi.spyOn(Date, "now").mockImplementation(function _Now() { return now; });
		const f = await _ToolContinuationHarness();
		const read = f.results.read.getMockImplementation()!;
		let pending = true;
		f.results.read.mockImplementation(async function _FileResult(turn)
		{
			if (pending)
				return { outcome: ConversationComputerToolResultOutcomes.GeneratedFilePending, operationId: "file-operation", notAfterEpochMs: now + 60_000 };
			const result = await read(turn);
			if (result.outcome !== ConversationComputerToolResultOutcomes.Available)
				return result;
			return { ...result, generatedFile: { state: ConversationGeneratedFileResultStates.Failed, operationId: "file-operation", failureCode: "scan_rejected" } };
		});

		expect(await f.authority.advance(f.step)).toMatchObject({ outcome: ConversationComputerToolResultOutcomes.GeneratedFilePending });
		const first = (await f.store.load(f.step))!.protocol.steps[0].reservation;
		now += 40_000;
		expect(await f.restart().advance(f.step)).toMatchObject({ outcome: ConversationComputerToolResultOutcomes.GeneratedFilePending });
		expect((await f.store.load(f.step))!.protocol.steps[0].reservation).toEqual(first);
		expect(f.model.request).toHaveBeenCalledOnce();
		expect(f.results.consume).not.toHaveBeenCalled();
		pending = false;
		expect(await f.restart().advance(f.step)).toEqual({ outcome: "completed" });
		const second = f.model.request.mock.calls[1][0];
		expect(second).toMatchObject({ tools: ConversationModelToolModes.None, maxCompletionTokens: 50 });
		expect(JSON.parse(second.history[0].resultContent)).toMatchObject({ filePublication: { state: "failed", failureCode: "scan_rejected" } });
		const saved = (await f.store.load(f.step))!;
		expect(saved.protocol.steps.at(-1)!.reservation.authorityExpiresAtEpochMs).toBeLessThanOrEqual(first!.authorityExpiresAtEpochMs);
		expect(await f.restart().advance(f.step)).toEqual({ outcome: "completed" });
		expect(f.model.request).toHaveBeenCalledTimes(2);
		expect(f.credentials.issueOnce).toHaveBeenCalledOnce();
		expect(f.toolFlags.executions).toBe(1);
	});

	it("refuses an attachment that changes during output preparation", async function _ChangedAttachment()
	{
		const f = await _ToolContinuationHarness();
		const read = f.results.read.getMockImplementation()!;
		let artifactRevisionId = "revision-1";
		f.results.read.mockImplementation(async function _FileResult(turn)
		{
			const result = await read(turn);
			if (result.outcome !== ConversationComputerToolResultOutcomes.Available)
				return result;
			return { ...result, generatedFile: { state: ConversationGeneratedFileResultStates.Ready, operationId: "file-operation", artifact: { id: "asset-1", kind: ConversationMessageContentBlockKinds.Artifact, artifactId: "artifact-1", artifactRevisionId, name: "counties.csv", mediaType: "text/csv;charset=utf-8" } } };
		});
		f.flags.duringVisibility = async function _ChangeAttachment() { artifactRevisionId = "substituted-revision"; };
		expect(await f.authority.advance(f.step)).toMatchObject({ outcome: "model_pending", ordinal: 2 });
		expect((await f.store.load(f.step))!.protocol.output).toBeNull();
		expect(f.fileLinks.link).not.toHaveBeenCalled();
		expect(f.model.request).toHaveBeenCalledTimes(2);
		expect(await f.restart().advance(f.step)).toMatchObject({ outcome: "model_pending", ordinal: 2 });
		expect(f.model.request).toHaveBeenCalledTimes(2);
	});

	it("refuses a changed file outcome after continuation custody without a second model request", async function _ChangedOutcome()
	{
		const f = await _ToolContinuationHarness();
		const read = f.results.read.getMockImplementation()!;
		let failureCode = "scan_rejected";
		f.results.read.mockImplementation(async function _FileResult(turn)
		{
			const result = await read(turn);
			if (result.outcome !== ConversationComputerToolResultOutcomes.Available)
				return result;
			return { ...result, generatedFile: { state: ConversationGeneratedFileResultStates.Failed, operationId: "file-operation", failureCode } };
		});
		const consume = f.results.consume.getMockImplementation()!;
		f.results.consume.mockImplementationOnce(async function _ChangeAfterReservation(turn)
		{
			failureCode = "different_failure";
			return consume(turn);
		});
		expect(await f.authority.advance(f.step)).toMatchObject({ outcome: "model_pending", ordinal: 2 });
		expect(f.model.request).toHaveBeenCalledOnce();
		expect(await f.restart().advance(f.step)).toMatchObject({ outcome: "model_pending", ordinal: 2 });
		expect(f.model.request).toHaveBeenCalledOnce();
	});
});
