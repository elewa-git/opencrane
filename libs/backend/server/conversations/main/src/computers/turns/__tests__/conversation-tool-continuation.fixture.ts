import { randomBytes } from "node:crypto";
import { vi } from "vitest";
import { ConversationModelResponseKinds, ConversationToolProposalOutcomes } from "@opencrane/contracts";
import { ___DigestCanonicalJson } from "@opencrane/util";

import { ConversationComputerToolResultOutcomes, type ConversationComputerToolResult } from "../conversation-computer-continuation.types";
import { ConversationComputerTurnProtocolStates } from "../conversation-computer-turn-protocol.types";
import type { ConversationComputerTurnCandidate, ConversationComputerTurnAuthorityDependencies, FrozenConversationComputerTurn } from "../conversation-computer-turn.types";
import { AesGcmConversationPrivatePayloadCipher } from "@opencrane/backend/server/conversations/history";
import { PrismaConversationModelCustodyUnitOfWork } from "../db/prisma-conversation-model-custody";
import { _OutputRecoveryHarness } from "./conversation-output-recovery.fixture";

/** Combine real turn CAS, current-Pod checks and encrypted custody with controlled ordered tools. */
export async function _ToolContinuationHarness(toolCount = 1, maxCompletionTokens = 100, prepareCandidate?: (candidate: ConversationComputerTurnCandidate) => void)
{
	const overrides: Partial<ConversationComputerTurnAuthorityDependencies> = {};
	const schema = { type: "object", required: ["query"], additionalProperties: false, properties: { query: { type: "string" } } };
	const tools = Array.from({ length: toolCount }, (_, index) =>
	{
		const name = index === 0 ? "records.lookup" : `records.lookup-${index + 1}`;
		const modelName = index === 0 ? "lookup_record" : `lookup_record_${index + 1}`;
		return { name, modelName, toolRevisionId: `tool-${index + 1}`, description: "Read a dedicated record", requiresApproval: false, parametersSchema: schema, parametersSchemaDigest: ___DigestCanonicalJson(schema) };
	});
	const calls = tools.map((tool, index) =>
	{
		const id = index === 0 ? "original-call-id" : `original-call-id-${index + 1}`;
		const argumentsText = index === 0 ? "{ \"query\": \"private-query\" }" : `{ \"query\": \"private-query-${index + 1}\" }`;
		const content = index === 0 ? "Private assistant declaration" : `Private assistant declaration ${index + 1}`;
		return { id, name: tool.modelName, arguments: argumentsText, content };
	});
	const f = await _OutputRecoveryHarness(false, overrides, candidate =>
	{
		Object.assign(candidate, { compiledInput: { ...candidate.compiledInput, tools, budget: { ...candidate.compiledInput.budget, maxCompletionTokens, maxModelTurns: toolCount + 1, maxToolInvocations: toolCount, maxLoopIterations: toolCount, wallClockDeadlineEpochMs: Date.now() + 240_000 } } });
		prepareCandidate?.(candidate);
	});
	const call = calls[0]!;
	f.model.request.mockImplementation(async function _Model(input)
	{
		if (input.history.length >= calls.length)
			return { kind: ConversationModelResponseKinds.Text, text: "A private chosen answer" };
		return { kind: ConversationModelResponseKinds.Tool, call: calls[input.history.length]! };
	});
	const rows = new Map<string, Record<string, any>>();
	const transaction = { conversationPrivatePayload: { findUnique: vi.fn(async ({ where }) => rows.get(where.id) ?? null), create: vi.fn(async ({ data }) =>
	{
		if (rows.has(data.id))
			throw new Error("unique payload conflict");
		rows.set(data.id, data);
		return data;
	}) } };
	const prisma = { $transaction: vi.fn(async operation => operation(transaction)) };
	const cipher = new AesGcmConversationPrivatePayloadCipher("key-1", { "key-1": randomBytes(32).toString("base64url") });
	const custody = new PrismaConversationModelCustodyUnitOfWork(prisma as never, cipher);
	const flags = { pending: false, allowed: true, consumed: false, executions: 0, acknowledgements: 0 };
	const consumedInvocations = new Set<string>();
	const admitted = new Set<string>();
	const proposals = { admit: vi.fn(async function _Admit(turn: FrozenConversationComputerTurn)
	{
		const selection = turn.protocol.steps.at(-1)?.selection;
		if (selection === null || selection === undefined)
			throw new Error("tool selection is missing");
		if (!admitted.has(selection.proposalId))
		{
			admitted.add(selection.proposalId);
			flags.executions++;
		}
		return { proposalId: selection.proposalId, outcome: ConversationToolProposalOutcomes.Existing };
	}) };
	const occurredAt = new Date().toISOString();
	const requestedNotifications = { publishRequested: vi.fn().mockResolvedValue("published") };
	const notifications = { publishTerminal: vi.fn().mockResolvedValue("published") };
	const resultFor = (selection: { readonly ordinal: number; readonly toolInvocationId: string }) =>
	{
		const payload = { toolInvocationId: selection.toolInvocationId, outcome: "succeeded" as const, result: { record: `private-result-${selection.ordinal}` } };
		return { outcome: ConversationComputerToolResultOutcomes.Available, payload, payloadDigest: ___DigestCanonicalJson(payload), toolRevisionId: `tool-${selection.ordinal}`, occurredAt, notAfterEpochMs: Date.now() + 60_000 } as const;
	};
	const results = {
		read: vi.fn(async function _Read(turn: FrozenConversationComputerTurn): Promise<ConversationComputerToolResult>
		{
			if (!flags.allowed)
				return { outcome: ConversationComputerToolResultOutcomes.Unavailable } as const;
			if (flags.pending)
				return { outcome: ConversationComputerToolResultOutcomes.Pending } as const;
			const selection = turn.protocol.steps.at(-1)?.selection ?? [...turn.protocol.steps].reverse().find(step => step.result !== null)?.selection;
			if (selection === null || selection === undefined)
				throw new Error("tool selection is missing");
			return resultFor(selection);
		}),
		consume: vi.fn(async function _Consume(turn: FrozenConversationComputerTurn): Promise<ConversationComputerToolResult>
		{
			const saved = (await f.store.load(turn.bootstrapId))!;
			const resultStep = [...saved.protocol.steps].reverse().find(step => step.result !== null);
			if (resultStep === undefined || resultStep.result === null || turn.protocol.state !== ConversationComputerTurnProtocolStates.ModelReserved)
				throw new Error("acknowledgement requires durable continuation evidence");
			const resultTurn = { ...turn, protocol: { ...saved.protocol, state: ConversationComputerTurnProtocolStates.ResultReady, steps: saved.protocol.steps.slice(0, -1) } } as FrozenConversationComputerTurn;
			const result = await results.read(resultTurn);
			if (result.outcome === ConversationComputerToolResultOutcomes.Available && !consumedInvocations.has(resultStep.selection.toolInvocationId))
			{
				consumedInvocations.add(resultStep.selection.toolInvocationId);
				flags.consumed = true;
				flags.acknowledgements++;
			}
			return result;
		}),
	};
	Object.assign(overrides, { modelCustody: custody, toolResults: results, toolProposals: proposals, toolRequestedNotifications: requestedNotifications, toolResultNotifications: notifications });
	return { ...f, authority: f.restart(), call, calls, rows, custody, results, requestedNotifications, notifications, proposals, toolFlags: flags, step: f.output.bootstrapId };
}
