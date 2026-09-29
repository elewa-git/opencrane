import { AgentRoutineProposalState, Prisma } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import { RoutineProposalStates } from "@opencrane/contracts";

import { PrismaRoutineProposalRepository } from "../prisma-routine-proposal-repository";
import { RoutineCommandConflictError } from "../routine-command.errors";
import { _CALLER, _INSTRUCTION, _NOW } from "./prisma-routine-test-fixtures";

const _SOURCE = { siloId: "silo-1", sourceConversationId: "conversation-source", runId: "run-1", attempt: 1, ordinal: 2, requesterPrincipalId: "principal-1" } as const;
const _ROW = {
	id: "proposal-1",
	siloId: _SOURCE.siloId,
	sourceConversationId: _SOURCE.sourceConversationId,
	sourceRunId: _SOURCE.runId,
	sourceRunAttempt: _SOURCE.attempt,
	sourceOrdinal: _SOURCE.ordinal,
	requesterPrincipalId: _SOURCE.requesterPrincipalId,
	suggestionKeyId: _INSTRUCTION.keyId,
	suggestionNonce: _INSTRUCTION.nonce,
	suggestionAuthTag: _INSTRUCTION.authTag,
	suggestionCiphertext: _INSTRUCTION.ciphertext,
	suggestionCiphertextDigest: _INSTRUCTION.ciphertextDigest,
	argumentsDigest: `sha256:${"b".repeat(64)}` as const,
	state: AgentRoutineProposalState.Pending,
	acceptedRoutineId: null,
	createdAt: new Date("2026-09-24T12:30:00.000Z"),
	expiresAt: new Date("2026-09-26T12:30:00.000Z"),
	terminalAt: null,
};

function _SourceAuthority()
{
	return { authorizeCreation: vi.fn().mockResolvedValue(_SOURCE), authorizeRequesterAccess: vi.fn().mockResolvedValue(_SOURCE) };
}

function _Repository(transaction: Record<string, unknown>, source = _SourceAuthority())
{
	const facts = { databaseNow: vi.fn().mockResolvedValue(_NOW) };
	return { repository: new PrismaRoutineProposalRepository(transaction as unknown as Prisma.TransactionClient, facts, source), facts, source };
}

function _CreateCommand()
{
	return { ..._SOURCE, proposalId: "proposal-1", suggestion: _INSTRUCTION, argumentsDigest: _ROW.argumentsDigest };
}

describe("PrismaRoutineProposalRepository", function _Suite()
{
	it("creates encrypted proposal material only after exact active-source authorization", async function _Create()
	{
		const create = vi.fn().mockResolvedValue(_ROW);
		const transaction = { agentRoutineProposal: { findFirst: vi.fn().mockResolvedValue(null), create } };
		const fixture = _Repository(transaction);

		await expect(fixture.repository.propose(_CreateCommand())).resolves.toEqual({ proposalRef: "proposal-1", expiresAt: _ROW.expiresAt.toISOString() });

		expect(fixture.source.authorizeCreation).toHaveBeenCalledWith(_SOURCE);
		expect(create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ suggestionCiphertext: _INSTRUCTION.ciphertext, argumentsDigest: _ROW.argumentsDigest }) }));
		expect(JSON.stringify(create.mock.calls)).not.toContain("Prepare");
	});

	it("recovers an exact source-slot replay and rejects a different argument digest", async function _Replay()
	{
		const transaction = { agentRoutineProposal: { findFirst: vi.fn().mockResolvedValue(_ROW), create: vi.fn() } };
		const fixture = _Repository(transaction);

		await expect(fixture.repository.propose(_CreateCommand())).resolves.toEqual({ proposalRef: "proposal-1", expiresAt: _ROW.expiresAt.toISOString() });
		await expect(fixture.repository.propose({ ..._CreateCommand(), argumentsDigest: `sha256:${"c".repeat(64)}` })).rejects.toBeInstanceOf(RoutineCommandConflictError);
		expect(transaction.agentRoutineProposal.create).not.toHaveBeenCalled();
	});

	it("uses later requester-access authorization and commits database-clock expiry on read", async function _Expiry()
	{
		const expired = { ..._ROW, expiresAt: new Date("2026-09-25T12:29:59.999Z") };
		const updateMany = vi.fn().mockResolvedValue({ count: 1 });
		const transaction = { agentRoutineProposal: { findFirst: vi.fn().mockResolvedValue(expired), updateMany, findUnique: vi.fn() } };
		const fixture = _Repository(transaction);

		const result = await fixture.repository.readProposal({ caller: _CALLER, proposalRef: "proposal-1" });

		expect(fixture.source.authorizeRequesterAccess).toHaveBeenCalledWith(_SOURCE);
		expect(fixture.source.authorizeCreation).not.toHaveBeenCalled();
		expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: { state: AgentRoutineProposalState.Expired, terminalAt: _NOW } }));
		expect(result?.state).toBe(RoutineProposalStates.Expired);
	});

	it("rereads the durable acceptance winner after cancellation loses its compare-and-set", async function _CancelWinner()
	{
		const winner = { ..._ROW, state: AgentRoutineProposalState.Accepted, acceptedRoutineId: "routine-1", terminalAt: _NOW };
		const transaction = { agentRoutineProposal: { findFirst: vi.fn().mockResolvedValue(_ROW), updateMany: vi.fn().mockResolvedValue({ count: 0 }), findUnique: vi.fn().mockResolvedValue(winner) } };
		const fixture = _Repository(transaction);

		const result = await fixture.repository.cancelProposal({ caller: _CALLER, proposalRef: "proposal-1" });

		expect(result).toMatchObject({ state: RoutineProposalStates.Accepted, acceptedRoutineId: "routine-1" });
	});

	it("returns content-free notification evidence only while exact, pending and unexpired", async function _NotificationEvidence()
	{
		const transaction = { agentRoutineProposal: { findFirst: vi.fn().mockResolvedValue(_ROW) } };
		const fixture = _Repository(transaction);
		const command = { ..._SOURCE, proposalRef: "proposal-1", expiresAt: _ROW.expiresAt.toISOString() };

		await expect(fixture.repository.readCurrent(command)).resolves.toEqual(command);
		expect(transaction.agentRoutineProposal.findFirst).toHaveBeenCalledWith({ where: expect.objectContaining({ state: AgentRoutineProposalState.Pending, expiresAt: { gt: _NOW } }) });
	});

	it("accepts once and rejects a compare-and-set loser after rereading another winner", async function _AcceptCas()
	{
		const transaction = { agentRoutineProposal: { updateMany: vi.fn().mockResolvedValue({ count: 1 }), findUnique: vi.fn() } };
		const fixture = _Repository(transaction);
		await expect(fixture.repository.acceptPrepared(_ROW as never, "routine-1", _NOW)).resolves.toBeUndefined();

		transaction.agentRoutineProposal.updateMany.mockResolvedValue({ count: 0 });
		transaction.agentRoutineProposal.findUnique.mockResolvedValue({ ..._ROW, state: AgentRoutineProposalState.Accepted, acceptedRoutineId: "routine-other" });
		await expect(fixture.repository.acceptPrepared(_ROW as never, "routine-1", _NOW)).rejects.toBeInstanceOf(RoutineCommandConflictError);
	});
});
