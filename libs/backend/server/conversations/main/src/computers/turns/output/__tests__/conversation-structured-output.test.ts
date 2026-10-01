import { describe, expect, it } from "vitest";
import { CompiledFinalOutputModes, ConversationEntryKinds, ConversationModelResponseKinds, type ConversationA2uiDisplay } from "@opencrane/contracts";

import { _OutputRecoveryHarness } from "../../__tests__/conversation-output-recovery.fixture";
import { _ConversationComputerOutputIntents, _ConversationStructuredOutputId } from "../conversation-computer-output-receipt";
import { _PrepareConversationStructuredOutput } from "../conversation-structured-output.validator";
import { _StructuredInventoryResult } from "./conversation-structured-output.fixture";
import { _ConversationComputerActiveTurnStreamName } from "../../../lifecycle/conversation-computer-activity";

/** Enables the explicitly compiled format without changing this fixture's authority or allowance. */
function _harness(reserve = true)
{
	return _OutputRecoveryHarness(reserve, {}, function _ConversationFormat(candidate)
	{
		Object.assign(candidate, { compiledInput: { ...candidate.compiledInput, finalOutput: CompiledFinalOutputModes.Conversation } });
	});
}

describe("production structured conversation output", function _Suite()
{
	it("carries the actual model final response through one atomic answer and display commit", async function _ModelOutput()
	{
		const f = await _harness(false);
		const display = _StructuredInventoryResult();
		f.model.request.mockResolvedValue({ kind: ConversationModelResponseKinds.Text, text: f.output.text, display });
		const participantAppends: number[] = [];
		f.history.beforeAppend = async function _Inspect(command)
		{
			if (command.streamName === f.stream)
				participantAppends.push(command.events.length);
		};
		await expect(f.authority.advance(f.output.bootstrapId)).resolves.toMatchObject({ outcome: "completed" });
		const turn = (await f.store.load(f.output.bootstrapId))!;
		const receipt = turn.protocol.output!.receipt;
		const entries = _ConversationComputerOutputIntents(receipt).map(intent => intent.event.data.entry);
		expect(participantAppends).toEqual([2]);
		expect(entries.map(entry => entry.kind)).toEqual([ConversationEntryKinds.Message, ConversationEntryKinds.A2UI]);
		expect(entries.map(entry => entry.position)).toEqual(["2", "3"]);
		expect(entries[1].author).toEqual(entries[0].author);
		expect(entries[1].runId).toBe(entries[0].runId);
		expect(entries[1].visibility).toEqual(entries[0].visibility);
		expect(entries[1].id).toBe(_ConversationStructuredOutputId(entries[0].id));
		const saved = f.payloads.get(turn.protocol.output!.sourceCommandId)!;
		expect(JSON.parse(saved.display!)[0].surfaceUpdate.surfaceId).toBe(entries[1].id);
		expect(saved.display).toContain("42 recorded units");
		expect(JSON.stringify(receipt)).not.toContain("42 recorded units");
		expect(JSON.stringify(receipt)).not.toContain(f.output.text);
		expect(f.model.request).toHaveBeenCalledOnce();
		expect(f.flags.runState).toBe("completed");
	});

	it.each(["intent", "history", "complete", "revoke"])("recovers both entries after a lost %s acknowledgement", async function _Recover(step)
	{
		const f = await _harness();
		const output = { ...f.output, display: _StructuredInventoryResult() };
		let lost = false;
		f.history.afterAppend = async function _Lose(command)
		{
			if (!lost && ((step === "intent" && command.events[0].type.endsWith("turn-output.v4")) || (step === "history" && command.streamName === f.stream)))
			{
				lost = true;
				throw new Error("response lost");
			}
		};
		if (step === "complete")
			f.runLifecycle.complete.mockRejectedValueOnce(new Error("response lost"));
		if (step === "revoke")
			f.credentials.revoke.mockRejectedValueOnce(new Error("response lost"));
		await expect(f.authority.appendOutput(output)).rejects.toThrow("response lost");
		const saved = (await f.store.load(f.output.bootstrapId))!.protocol.output!.receipt;
		f.flags.stamp = 100;
		await expect(f.restart().start(f.workflowCommand)).resolves.toBeNull();
		expect(f.history.streams.get(f.stream)!.slice(2).map(event => event.data)).toEqual(_ConversationComputerOutputIntents(saved).map(intent => intent.event.data));
		expect(f.flags.payloadWrites).toBe(1);
		expect(f.model.request).not.toHaveBeenCalled();
		expect(f.flags.runState).toBe("completed");
	});

	it.each(["text", "display", "absence"])("refuses a changed %s on an explicit saved-output retry", async function _Changed(kind)
	{
		const f = await _harness();
		const output = { ...f.output, display: _StructuredInventoryResult() };
		await f.authority.appendOutput(output);
		const changed = structuredClone(output);
		if (kind === "text")
			changed.text = "Changed answer";
		if (kind === "display")
			Object.assign(changed.display[0].surfaceUpdate.components[3].component.Text!, { text: { literalString: "Changed total" } });
		const retry = kind === "absence" ? f.output : changed;
		await expect(f.restart().appendOutput(retry)).rejects.toThrow();
		await expect(f.restart().appendOutput(output)).resolves.toBe("idempotent");
		expect(f.history.streams.get(f.stream)).toHaveLength(4);
	});

	it("does not append after permission ends while the companion is being prepared", async function _AuthorityEnds()
	{
		const f = await _harness();
		let preparations = 0;
		f.flags.duringVisibility = async function _Revoke()
		{
			if (++preparations === 2)
				f.flags.mayAppend = false;
		};
		await expect(f.authority.appendOutput({ ...f.output, display: _StructuredInventoryResult() })).rejects.toThrow();
		expect(f.history.streams.get(f.stream)).toHaveLength(2);
		expect((await f.store.load(f.output.bootstrapId))!.protocol.output).toBeNull();
		expect(f.runLifecycle.complete).not.toHaveBeenCalled();
	});

	it("requires both exact history entries before finishing recovery", async function _MissingDisplay()
	{
		const f = await _harness();
		f.runLifecycle.complete.mockRejectedValueOnce(new Error("pause after output"));
		await expect(f.authority.appendOutput({ ...f.output, display: _StructuredInventoryResult() })).rejects.toThrow("pause after output");
		f.history.streams.get(f.stream)!.pop();
		f.runLifecycle.complete.mockClear();
		await expect(f.restart().start(f.workflowCommand)).rejects.toThrow("cannot confirm");
		expect(f.runLifecycle.complete).not.toHaveBeenCalled();
		expect(f.credentials.revoke).not.toHaveBeenCalled();
	});

	it("refuses a display when the frozen model request was plain text", async function _UnrequestedDisplay()
	{
		const f = await _OutputRecoveryHarness();
		await expect(f.authority.appendOutput({ ...f.output, display: _StructuredInventoryResult() })).rejects.toThrow("not requested");
		expect(f.outputPayloads.store).not.toHaveBeenCalled();
	});

	it("retains one complete output when identical responses prepare concurrently", async function _Concurrent()
	{
		const f = await _harness();
		let release!: () => void;
		const ready = new Promise<void>(function _Wait(resolve) { release = resolve; });
		let prepared = 0;
		f.history.beforeAppend = async function _BothPrepared(command)
		{
			if (!command.events[0].type.endsWith("turn-output.v4"))
				return;
			if (++prepared === 2)
				release();
			await ready;
		};
		const output = { ...f.output, display: _StructuredInventoryResult() };
		await Promise.all([f.authority.appendOutput(output), f.restart().appendOutput(output)]);
		expect(f.history.streams.get(f.stream)).toHaveLength(4);
		expect(f.flags.payloadWrites).toBe(1);
		const receipt = (await f.store.load(f.output.bootstrapId))!.protocol.output!.receipt;
		expect(f.history.streams.get(f.stream)!.slice(2).map(event => event.data)).toEqual(_ConversationComputerOutputIntents(receipt).map(intent => intent.event.data));
	});

	it("refuses the whole output when cancellation wins its atomic turn revision", async function _CancellationWins()
	{
		const f = await _harness();
		let pending = true;
		f.history.beforeAppend = async function _StopBeforeCommit(command)
		{
			if (!pending || !command.events[0].type.endsWith("turn-output.v4"))
				return;
			pending = false;
			const turn = (await f.store.load(f.output.bootstrapId))!;
			const activeStream = _ConversationComputerActiveTurnStreamName(turn);
			const activeRevision = f.history.streams.get(activeStream)!.at(-1)!.revision;
			const appends = f.store.cancellationAppends(turn, { commandId: "ceae23e7-cb1b-49a2-989d-c425f22d1d79", commandDigest: `sha256:${"c".repeat(64)}`, occurredAt: new Date().toISOString() }, activeRevision);
			await f.history.appendAtomic({ expectedHeads: appends.map(append => ({ streamName: append.streamName, revision: append.expectedRevision })), appends });
		};
		await expect(f.authority.appendOutput({ ...f.output, display: _StructuredInventoryResult() })).rejects.toThrow();
		expect((await f.store.load(f.output.bootstrapId))!.protocol.state).toBe("cancelled");
		expect(f.history.streams.get(f.stream)).toHaveLength(2);
		expect(f.runLifecycle.complete).not.toHaveBeenCalled();
	});

	it("keeps payload-only retries bound to the original complete output", async function _PayloadSaved()
	{
		const f = await _harness();
		let fail = true;
		f.history.beforeAppend = async function _HistoryUnavailable(command)
		{
			if (fail && command.events[0].type.endsWith("turn-output.v4"))
				throw new Error("history unavailable");
		};
		const output = { ...f.output, display: _StructuredInventoryResult() };
		await expect(f.authority.appendOutput(output)).rejects.toThrow("history unavailable");
		expect((await f.store.load(f.output.bootstrapId))!.protocol.output).toBeNull();
		await expect(f.restart().appendOutput(f.output)).rejects.toThrow("different text");
		fail = false;
		await expect(f.restart().appendOutput(output)).resolves.toBe("accepted");
		expect(f.flags.payloadWrites).toBe(1);
		expect(f.history.streams.get(f.stream)).toHaveLength(4);
		expect(f.model.request).not.toHaveBeenCalled();
	});
});

describe("complete participant display validation", function _Validation()
{
	it("preserves literal text but assigns the server-owned display identity", function _Valid()
	{
		const source = "31c1f1dc-0010-4f13-9c2f-d3841ffd6651";
		const original = _StructuredInventoryResult();
		const payload = _PrepareConversationStructuredOutput(original, source)!;
		expect(JSON.parse(payload)[1].beginRendering.surfaceId).toBe(_ConversationStructuredOutputId(source));
		expect(payload).toContain("<review>");
		expect(original[0].surfaceUpdate.surfaceId).toBe("conversation-result");
	});

	it.each(["missing", "cycle", "duplicate", "orphan", "binding", "deep", "expanded", "foreign", "action"])("refuses %s graphs before payload persistence", function _Invalid(kind)
	{
		const display = _StructuredInventoryResult();
		const components = display[0].surfaceUpdate.components;
		if (kind === "missing")
			Object.assign(display[1].beginRendering, { root: "missing" });
		if (kind === "cycle")
			Object.assign(components[0].component.Card!, { child: "root" });
		if (kind === "duplicate")
			components.push(structuredClone(components[0]));
		if (kind === "orphan")
			components.push({ id: "hidden", component: { Text: { text: { literalString: "must not be stored" } } } });
		if (kind === "binding")
			Object.assign(components[3].component.Text!, { text: { path: "/private" } });
		if (kind === "deep")
		{
			for (let index = 0; index < 20; index++)
				components.push({ id: `deep-${index}`, component: { Card: { child: index === 19 ? "root" : `deep-${index + 1}` } } });
			Object.assign(display[1].beginRendering, { root: "deep-0" });
		}
		if (kind === "expanded")
		{
			for (let index = 0; index < 9; index++)
				components.push({ id: `fan-${index}`, component: { Column: { children: { explicitList: Array.from({ length: 2 }, function _Child() { return index === 8 ? "root" : `fan-${index + 1}`; }) } } } });
			Object.assign(display[1].beginRendering, { root: "fan-0" });
		}
		if (kind === "foreign")
			Object.assign(display[0].surfaceUpdate, { surfaceId: "existing-user-display" });
		if (kind === "action")
			Object.assign(components[3].component, { Button: { action: { name: "write" } } });
		expect(function _Parse() { _PrepareConversationStructuredOutput(display as ConversationA2uiDisplay, "source"); }).toThrow("Conversation structured output is invalid");
	});
});
