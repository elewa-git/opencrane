import { afterEach, describe, expect, it, vi } from "vitest";

import { ConversationModelResponseKinds, ConversationModelToolModes, type ConversationModelRequest, type ConversationModelResponse } from "@opencrane/contracts";
import { ___DigestCanonicalJson } from "@opencrane/util";

import { ConversationComputerToolResultOutcomes } from "../conversation-computer-continuation.types";
import { ConversationComputerTurnProtocolStates } from "../conversation-computer-turn-protocol.types";
import { _ToolContinuationHarness } from "./conversation-tool-continuation.fixture";

/** Restores the clock after the controlled restart. */
afterEach(function _restore() { vi.restoreAllMocks(); });

/** Uses saved exchanges to choose pages and calculate the answer; this is not a live model. */
async function _scriptedInventoryModel(input: ConversationModelRequest): Promise<ConversationModelResponse>
{
	if (input.history.length === 0)
		return { kind: ConversationModelResponseKinds.Tool, call: { id: "inventory-discovery-call", name: "discover_inventory", arguments: "{}", content: "Discover the inventory feed." } };
	if (JSON.parse(input.history.at(-1)!.resultContent).result.nextCursor === null)
	{
		const items = input.history.slice(1).flatMap(exchange => JSON.parse(exchange.resultContent).result.items);
		const quantity = items.reduce((total, item) => total + item.quantity, 0);
		return { kind: ConversationModelResponseKinds.Text, text: `Counted ${items.length} inventory records totaling ${quantity} units.` };
	}
	const discovery = JSON.parse(input.history[0]!.resultContent).result;
	const previous = input.history.at(-1)!;
	const filter = input.history.length === 1 ? discovery.filter : JSON.parse(previous.call.arguments).filter;
	const cursor = input.history.length === 1 ? discovery.cursor : JSON.parse(previous.resultContent).result.nextCursor;
	return { kind: ConversationModelResponseKinds.Tool, call: { id: `inventory-page-call-${input.history.length}`, name: discovery.pageTool, arguments: JSON.stringify({ filter, cursor }), content: "Read the next inventory page." } };
}

/** Supplies controlled inventory results to the real turn store and encrypted exchange custody. */
async function _inventoryHarness()
{
	const discoverySchema = { type: "object", additionalProperties: false, properties: {} };
	const pageSchema = { type: "object", required: ["filter", "cursor"], additionalProperties: false, properties: { filter: { type: "object", required: ["warehouseId"], additionalProperties: false, properties: { warehouseId: { type: "string" } } }, cursor: { type: "string" } } };
	const f = await _ToolContinuationHarness(5, 600, function _inventoryCandidate(candidate)
	{
		Object.assign(candidate, { compiledInput: {
			...candidate.compiledInput,
			tools: [
				{ name: "inventory.discover", modelName: "discover_inventory", toolRevisionId: "inventory-discovery-revision-2", description: "Discover an inventory feed", requiresApproval: false, parametersSchema: discoverySchema, parametersSchemaDigest: ___DigestCanonicalJson(discoverySchema) },
				{ name: "inventory.page", modelName: "read_inventory_page", toolRevisionId: "inventory-pages-revision-7", description: "Read one inventory page", requiresApproval: false, parametersSchema: pageSchema, parametersSchemaDigest: ___DigestCanonicalJson(pageSchema) },
			],
			budget: { ...candidate.compiledInput.budget, wallClockDeadlineEpochMs: Date.now() + 120_000 },
		} });
	});
	const replies = [
		{ callId: "inventory-discovery-call", name: "discover_inventory", arguments: {}, result: { pageTool: "read_inventory_page", filter: { warehouseId: "warehouse-north" }, cursor: "cursor-first" } },
		{ callId: "inventory-page-call-1", name: "read_inventory_page", arguments: { filter: { warehouseId: "warehouse-north" }, cursor: "cursor-first" }, result: { items: [{ id: "stock-a", quantity: 7 }, { id: "stock-b", quantity: 11 }], nextCursor: "cursor-second" } },
		{ callId: "inventory-page-call-2", name: "read_inventory_page", arguments: { filter: { warehouseId: "warehouse-north" }, cursor: "cursor-second" }, result: { items: [{ id: "stock-c", quantity: 13 }], nextCursor: null } },
	] as const;
	const occurredAt = new Date().toISOString();
	f.results.read.mockImplementation(async function _readInventoryResult(turn)
	{
		const selection = turn.protocol.steps.at(-1)?.selection ?? [...turn.protocol.steps].reverse().find(step => step.result !== null)?.selection;
		if (selection === undefined || selection === null)
			throw new Error("Inventory result requires a saved tool selection");
		const saved = await f.custody.loadDeclaration(turn, selection.ordinal);
		if (saved === null)
			throw new Error("Inventory result requires a saved declaration");
		const reply = replies[selection.ordinal - 1]!;
		expect(saved.declaration.call).toMatchObject({ id: reply.callId, name: reply.name, arguments: JSON.stringify(reply.arguments) });
		const tool = f.candidate.compiledInput.tools.find(tool => tool.modelName === saved.declaration.call.name)!;
		const payload = { toolInvocationId: selection.toolInvocationId, outcome: "succeeded" as const, result: reply.result };
		return { outcome: ConversationComputerToolResultOutcomes.Available, payload, payloadDigest: ___DigestCanonicalJson(payload), toolRevisionId: tool.toolRevisionId, occurredAt, notAfterEpochMs: f.candidate.compiledInput.budget.wallClockDeadlineEpochMs + 60_000 };
	});
	f.model.request.mockImplementation(_scriptedInventoryModel);
	return { ...f, replies };
}

describe("controlled inventory pagination and recovery", function _suite()
{
	/** Proves the source continuation contract with scripted ports, not live Odoo or model quality. */
	it("recovers same-revision pagination and totals the saved pages at the end cursor with allowance remaining", async function _paginationRecovery()
	{
		let now = Date.now();
		vi.spyOn(Date, "now").mockImplementation(function _now() { return now; });
		const f = await _inventoryHarness();
		const originalBudget = structuredClone(f.candidate.compiledInput.budget);
		f.history.beforeAppend = async function _interruptBeforePageTwo(command)
		{
			if ((command.events[0].data["reservation"] as { ordinal?: number } | undefined)?.ordinal === 3)
				throw new Error("Server stopped after saving the first inventory page");
		};
		expect(await f.authority.advance(f.step)).toEqual({ outcome: "retry" });
		const saved = (await f.store.load(f.step))!;
		expect(saved.protocol.state).toBe(ConversationComputerTurnProtocolStates.ResultReady);
		expect(saved.protocol.accounting).toEqual({ reservedModelCalls: 2, reservedCompletionTokens: 200, reservedToolInvocations: 2, toolResultCyclesFed: 1 });
		expect(f.toolFlags.executions).toBe(2);
		expect(f.model.request).toHaveBeenCalledTimes(2);
		const pageOne = await f.custody.loadExchange(saved, saved.protocol.steps[1]!.result!.exchange);
		expect(JSON.parse(pageOne.resultContent).result).toEqual(f.replies[1]!.result);

		now = originalBudget.wallClockDeadlineEpochMs - 10_000;
		f.history.beforeAppend = async function _resume() {};
		const restarted = f.restart();
		expect(restarted).not.toBe(f.authority);
		expect(await restarted.advance(f.step)).toEqual({ outcome: "completed" });
		const completed = (await f.store.load(f.step))!;
		const requests: ConversationModelRequest[] = f.model.request.mock.calls.map(call => call[0]);
		expect(requests.map(request => request.history.length)).toEqual([0, 1, 2, 3]);
		expect(requests.map(request => request.maxCompletionTokens)).toEqual([100, 100, 100, 100]);
		expect(requests.map(request => request.tools)).toEqual(Array(4).fill(ConversationModelToolModes.Select));
		for (const request of requests)
			expect(request.compiledInput).toEqual(f.candidate.compiledInput);
		expect(completed.budget).toEqual(originalBudget);
		expect(completed.protocol.steps.map(step => step.reservation.authorityExpiresAtEpochMs)).toEqual(Array(4).fill(originalBudget.wallClockDeadlineEpochMs));
		expect(requests.slice(2).map(request => request.notAfterEpochMs)).toEqual(Array(2).fill(originalBudget.wallClockDeadlineEpochMs));
		expect(completed.protocol.accounting).toEqual({ reservedModelCalls: 4, reservedCompletionTokens: 400, reservedToolInvocations: 3, toolResultCyclesFed: 3 });
		expect(completed.protocol.accounting.reservedModelCalls).toBeLessThan(originalBudget.maxModelTurns);
		expect(completed.protocol.accounting.reservedCompletionTokens).toBeLessThan(originalBudget.maxCompletionTokens);
		expect(completed.protocol.accounting.reservedToolInvocations).toBeLessThan(originalBudget.maxToolInvocations);
		expect(completed.protocol.accounting.toolResultCyclesFed).toBeLessThan(originalBudget.maxLoopIterations);
		expect(completed.protocol.steps.slice(0, 2)).toEqual(saved.protocol.steps);
		const exchanges = [];
		for (const step of completed.protocol.steps.slice(0, 3))
			exchanges.push(await f.custody.loadExchange(completed, step.result!.exchange));
		expect(exchanges[1]).toEqual(pageOne);
		expect(exchanges.map(exchange => ({ id: exchange.call.id, name: exchange.call.name, arguments: JSON.parse(exchange.call.arguments), result: JSON.parse(exchange.resultContent).result }))).toEqual(f.replies.map(reply => ({ id: reply.callId, name: reply.name, arguments: reply.arguments, result: reply.result })));
		expect(requests[2]!.history).toEqual(exchanges.slice(0, 2).map(exchange => ({ call: exchange.call, resultContent: exchange.resultContent })));
		expect(requests[3]!.history).toEqual(exchanges.map(exchange => ({ call: exchange.call, resultContent: exchange.resultContent })));
		for (const [index, exchange] of exchanges.entries())
		{
			const revision = index === 0 ? "inventory-discovery-revision-2" : "inventory-pages-revision-7";
			expect(f.proposals.admit).toHaveBeenNthCalledWith(index + 1, expect.anything(), expect.anything(), { bootstrapId: f.step, toolRevisionId: revision, arguments: JSON.parse(exchange.call.arguments) }, expect.anything());
		}
		expect(new Set(exchanges.map(exchange => exchange.call.id)).size).toBe(3);
		expect(new Set(exchanges.map(exchange => exchange.toolInvocationId)).size).toBe(3);
		expect(f.proposals.admit).toHaveBeenCalledTimes(3);
		expect(f.toolFlags).toMatchObject({ executions: 3, acknowledgements: 3 });
		expect(f.credentials.issueOnce).toHaveBeenCalledOnce();
		expect(f.credentials.reuseExact).toHaveBeenCalledTimes(3);
		expect(f.rows.size).toBe(6);
		expect([...f.payloads.values()].map(payload => payload.text)).toEqual(["Counted 3 inventory records totaling 31 units."]);
		expect(f.outputPayloads.store).toHaveBeenCalledOnce();
	});
});
