import { describe, expect, it, vi } from "vitest";

import { REQUEST_ROUTINE_TOOL } from "@opencrane/backend/server/agents/scheduling/contract";
import { ConversationModelResponseKinds } from "@opencrane/contracts";
import { ___DigestCanonicalJson } from "@opencrane/util";

import type { ConversationComputerModelCustody, ConversationComputerToolDeclaration, ConversationComputerToolExchange } from "../conversation-computer-continuation.types";
import { ConversationComputerTurnToolKinds } from "../conversation-computer-turn-protocol.types";
import type { ConversationComputerPrivateModelReference } from "../conversation-computer-turn-protocol.types";
import type { ConversationComputerTurnAuthorityDependencies } from "../conversation-computer-turn.types";
import { ConversationRoutineProposalNotificationOutcomes } from "../request-routine/conversation-request-routine.types";
import { _OutputRecoveryHarness } from "./conversation-output-recovery.fixture";

const _EXPIRES_AT = "2098-01-01T00:00:00.000Z";

function _Custody(): ConversationComputerModelCustody
{
	const declarations = new Map<number, { readonly declaration: ConversationComputerToolDeclaration; readonly reference: ConversationComputerPrivateModelReference }>();
	const exchanges = new Map<string, ConversationComputerToolExchange>();
	return {
		async storeDeclaration(_turn, declaration)
		{
			const reference = { payloadRef: `declaration-${declaration.ordinal}`, ciphertextDigest: ___DigestCanonicalJson(declaration.call as never) };
			declarations.set(declaration.ordinal, { declaration, reference });
			return reference;
		},
		async loadDeclaration(_turn, ordinal)
		{
			return declarations.get(ordinal ?? Math.max(...declarations.keys())) ?? null;
		},
		async storeExchange(_turn, exchange)
		{
			const reference = { payloadRef: `exchange-${exchange.ordinal}`, ciphertextDigest: exchange.resultDigest };
			exchanges.set(reference.payloadRef, exchange);
			return reference;
		},
		async loadExchange(_turn, reference)
		{
			const exchange = exchanges.get(reference.payloadRef);
			if (exchange === undefined)
				throw new Error("fixture exchange is missing");
			return exchange;
		},
	};
}

async function _Fixture(requestRoutine?: ConversationComputerTurnAuthorityDependencies["requestRoutine"])
{
	const custody = _Custody();
	const overrides: Partial<ConversationComputerTurnAuthorityDependencies> = requestRoutine === undefined ? { modelCustody: custody } : { modelCustody: custody, requestRoutine };
	const fixture = await _OutputRecoveryHarness(false, overrides, function _Prepare(candidate)
	{
		Object.assign(candidate, { compiledInput: { ...candidate.compiledInput, tools: [REQUEST_ROUTINE_TOOL], budget: { ...candidate.compiledInput.budget, maxModelTurns: 2, maxToolInvocations: 1, maxLoopIterations: 1, maxCompletionTokens: 100, wallClockDeadlineEpochMs: Date.now() + 120_000 } } });
	});
	fixture.model.request.mockImplementation(async function _Model(input)
	{
		if (input.history.length === 0)
			return { kind: ConversationModelResponseKinds.Tool, call: { id: "routine-call-1", name: "request_routine", arguments: JSON.stringify({ instruction: "Send a weekly summary", schedule: { expression: "0 9 * * 1", timezone: "Europe/Brussels" } }), content: null } };
		return { kind: ConversationModelResponseKinds.Text, text: "I prepared the routine for your review." };
	});
	return fixture;
}

describe("request_routine model continuation", function _RequestRoutineContinuationSuite()
{
	it("persists a scheduling proposal, publishes one safe notification and feeds its receipt to the next model call", async function _CompletesRequestRoutine()
	{
		const proposals = { propose: vi.fn().mockResolvedValue({ proposalRef: "routine-proposal-1", expiresAt: _EXPIRES_AT }) };
		const sources = { resolve: vi.fn().mockResolvedValue({ siloId: "silo-1", sourceConversationId: "conversation-1", runId: "run-1", attempt: 1, ordinal: 1, requesterPrincipalId: "principal-1" }) };
		const notifications = { publish: vi.fn().mockResolvedValue(ConversationRoutineProposalNotificationOutcomes.Published) };
		const f = await _Fixture({ proposals, sources, notifications });

		const progress = await f.authority.advance(f.output.bootstrapId);
		expect(proposals.propose).toHaveBeenCalledWith(expect.objectContaining({ ordinal: 1, suggestion: { instruction: "Send a weekly summary", schedule: { expression: "0 9 * * 1", timezone: "Europe/Brussels" } } }));
		expect(notifications.publish).toHaveBeenCalledWith(expect.objectContaining({ proposalRef: "routine-proposal-1", requesterPrincipalId: "principal-1" }));
		expect(f.model.request).toHaveBeenCalledTimes(2);
		const second = f.model.request.mock.calls[1]![0];
		expect(second.history[0].resultContent).toBe(`{"expiresAt":"${_EXPIRES_AT}","outcome":"ready_for_review","proposalRef":"routine-proposal-1"}`);
		const saved = await f.store.load(f.output.bootstrapId);
		expect(saved?.protocol.steps[0]?.selection).toMatchObject({ kind: ConversationComputerTurnToolKinds.RequestRoutine, proposalRef: "routine-proposal-1", expiresAt: _EXPIRES_AT });
		expect(saved?.protocol.steps[0]?.result).toMatchObject({ kind: ConversationComputerTurnToolKinds.RequestRoutine, proposalRef: "routine-proposal-1" });
		expect(JSON.stringify([...f.history.streams.values()], (_key, value) => typeof value === "bigint" ? String(value) : value)).not.toContain("Send a weekly summary");
		expect(progress).toEqual({ outcome: "completed" });
	});

	it("recovers a saved declaration after a lost proposal acknowledgement without another model request", async function _LostProposalAcknowledgement()
	{
		let attempts = 0;
		const receipt = { proposalRef: "routine-proposal-1", expiresAt: _EXPIRES_AT };
		const proposals = { propose: vi.fn(async function _Propose()
		{
			attempts += 1;
			if (attempts === 1)
				throw new Error("proposal acknowledgement lost");
			return receipt;
		}) };
		const requestRoutine = { proposals, sources: { resolve: vi.fn().mockResolvedValue({ siloId: "silo-1", sourceConversationId: "conversation-1", runId: "run-1", attempt: 1, ordinal: 1, requesterPrincipalId: "principal-1" }) }, notifications: { publish: vi.fn().mockResolvedValue(ConversationRoutineProposalNotificationOutcomes.Published) } };
		const f = await _Fixture(requestRoutine);

		expect(await f.authority.advance(f.output.bootstrapId)).toMatchObject({ outcome: "model_pending" });
		expect(await f.restart().advance(f.output.bootstrapId)).toEqual({ outcome: "completed" });
		expect(f.model.request).toHaveBeenCalledTimes(2);
		expect(proposals.propose).toHaveBeenCalledTimes(2);
		expect(requestRoutine.notifications.publish).toHaveBeenCalledOnce();
	});

	it("fails closed when the first-party dispatcher is null or omitted", async function _MissingDispatcher()
	{
		for (const requestRoutine of [null, undefined])
		{
			const f = await _Fixture(requestRoutine);
			expect(await f.authority.advance(f.output.bootstrapId)).toEqual({ outcome: "response_unavailable" });
			expect(f.model.request).toHaveBeenCalledOnce();
		}
	});
});
