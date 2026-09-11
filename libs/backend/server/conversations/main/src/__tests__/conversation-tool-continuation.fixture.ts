import { randomBytes } from "node:crypto";
import { vi } from "vitest";
import { ConversationModelResponseKinds, ConversationToolProposalOutcomes } from "@opencrane/contracts";
import { ___DigestCanonicalJson } from "@opencrane/util";

import { ConversationComputerToolResultOutcomes } from "../conversation-computer-continuation.types";
import type { ConversationComputerTurnAuthorityDependencies, FrozenConversationComputerTurn } from "../conversation-computer-turn.types";
import { AesGcmConversationPrivatePayloadCipher } from "../conversation-private-payload-cipher";
import { PrismaConversationModelCustodyUnitOfWork } from "../db/prisma-conversation-model-custody";
import { _OutputRecoveryHarness } from "./conversation-output-recovery.fixture";

/** Combine real turn CAS, current-Pod checks and encrypted custody with a controlled terminal tool. */
export async function _ToolContinuationHarness()
{
	const overrides: Partial<ConversationComputerTurnAuthorityDependencies> = {};
	const f = await _OutputRecoveryHarness(false, overrides);
	const schema = { type: "object", required: ["query"], additionalProperties: false, properties: { query: { type: "string" } } };
	Object.assign(f.candidate, { compiledInput: { ...f.candidate.compiledInput, tools: [{ name: "lookup_record", toolRevisionId: "tool-1", description: "Read a dedicated record", requiresApproval: false, parametersSchema: schema, parametersSchemaDigest: ___DigestCanonicalJson(schema) }], budget: { ...f.candidate.compiledInput.budget, maxModelTurns: 2, maxToolInvocations: 1, wallClockDeadlineEpochMs: Date.now() + 240_000 } } });
	const call = { id: "original-call-id", name: "lookup_record", arguments: "{ \"query\": \"private-query\" }", content: "Private assistant declaration" };
	f.model.request.mockImplementation(async function _Model(input)
	{
		return input.continuation === null ? { kind: ConversationModelResponseKinds.Tool, call } : { kind: ConversationModelResponseKinds.Text, text: "A private chosen answer" };
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
	let admitted: string | null = null;
	const proposals = { admit: vi.fn(async function _Admit(turn: FrozenConversationComputerTurn)
	{
		if (admitted === null)
		{
			admitted = turn.toolSelection!.proposalId;
			flags.executions++;
		}
		if (admitted !== turn.toolSelection?.proposalId)
			throw new Error("another proposal already owns this attempt");
		return { proposalId: admitted, outcome: ConversationToolProposalOutcomes.Existing };
	}) };
	const results = {
		read: vi.fn(async function _Read(turn: FrozenConversationComputerTurn)
		{
			if (!flags.allowed)
				return { outcome: ConversationComputerToolResultOutcomes.Unavailable } as const;
			if (flags.pending)
				return { outcome: ConversationComputerToolResultOutcomes.Pending } as const;
			const payload = { toolInvocationId: turn.toolSelection!.proposalId, outcome: "succeeded" as const, result: { record: "private-result" } };
			return { outcome: ConversationComputerToolResultOutcomes.Available, payload, payloadDigest: ___DigestCanonicalJson(payload), notAfterEpochMs: Date.now() + 60_000 } as const;
		}),
		consume: vi.fn(async function _Consume(turn: FrozenConversationComputerTurn)
		{
			const saved = (await f.store.load(turn.bootstrapId))!;
			if (saved.continuationReservation === null || saved.continuationReservation.invocationFence !== turn.continuationReservation?.invocationFence)
				throw new Error("acknowledgement requires durable continuation evidence");
			const result = await results.read(turn);
			if (result.outcome === ConversationComputerToolResultOutcomes.Available && !flags.consumed)
			{
				flags.consumed = true;
				flags.acknowledgements++;
			}
			return result;
		}),
	};
	Object.assign(overrides, { modelCustody: custody, toolResults: results, toolProposals: proposals });
	return { ...f, authority: f.restart(), call, rows, custody, results, proposals, toolFlags: flags, step: { bootstrapId: f.output.bootstrapId, process: f.command.process } };
}
