import { AgentServiceKind, ConversationMode } from "@prisma/client";
import { AgentConfigPatchKinds } from "@opencrane/contracts";
import { describe, expect, it, vi } from "vitest";

import { PersonalConfigurationProposalCodes, type ProposePersonalConfigurationChangeCommand } from "../proposal/personal-configuration-proposal.types.js";
import { PrismaPersonalConfigurationProposalRepository } from "../proposal/prisma-personal-configuration-proposal-repository.js";

/** Optional rows returned by the transaction double at each provenance fence. */
interface ProposalTransactionOverrides
{
	/** Owner-bound persona profile evidence. */
	readonly profile?: unknown;
	/** Active conversation-participant evidence. */
	readonly conversation?: unknown;
	/** Exact run-coordinate evidence. */
	readonly run?: unknown;
	/** Personal-service revision evidence. */
	readonly service?: unknown;
}

/** One fail-closed provenance case and the number of reads allowed before denial. */
interface ProposalConflictCase
{
	/** Human-readable fence failure used in the generated test title. */
	readonly label: string;
	/** Transaction rows that make the named fence fail. */
	readonly overrides: ProposalTransactionOverrides;
	/** Sequential lookups reached before the repository must stop. */
	readonly expectedLookupCount: number;
}

/** Build one transaction double with successful provenance unless a row is overridden. */
function _transaction(overrides: ProposalTransactionOverrides = {})
{
	return {
		personaProfile: { findFirst: vi.fn(async function _findProfile() { return overrides.profile === undefined ? { activeRevisionId: "persona-1" } : overrides.profile; }) },
		conversation: { findFirst: vi.fn(async function _findConversation() { return overrides.conversation === undefined ? { agentServiceId: "service-1" } : overrides.conversation; }) },
		agentRun: { findFirst: vi.fn(async function _findRun() { return overrides.run === undefined ? { id: "run-1" } : overrides.run; }) },
		agentService: { findFirst: vi.fn(async function _findService() { return overrides.service === undefined ? { activeRevisionId: "agent-1" } : overrides.service; }) },
		personalConfigurationChange: { create: vi.fn(async function _createProposal() { return { id: "change-1" }; }) },
	};
}

/** Build the exact validated command admitted to the transaction repository. */
function _command(): ProposePersonalConfigurationChangeCommand
{
	return {
		siloId: "silo-1",
		userId: "user-1",
		personaProfileId: "profile-1",
		agentServiceId: "service-1",
		sourceConversationId: "conversation-1",
		sourceRunId: "run-1",
		sourceMessageId: "message-1",
		requestedPatch: { kind: AgentConfigPatchKinds.ModelAlias, modelAlias: "careful-model" },
		requestedPatchDigest: `sha256:${"a".repeat(64)}`,
		expectedPersonaRevisionId: "persona-1",
		expectedAgentRevisionId: "agent-1",
		proposedAt: "2026-07-23T00:00:00.000Z",
	};
}

/** Every mutable evidence failure and the last lookup it may reach. */
const _PROVENANCE_CONFLICTS: readonly ProposalConflictCase[] = [
	{ label: "a missing profile", overrides: { profile: null }, expectedLookupCount: 1 },
	{ label: "a changed persona revision", overrides: { profile: { activeRevisionId: "persona-2" } }, expectedLookupCount: 1 },
	{ label: "a missing conversation", overrides: { conversation: null }, expectedLookupCount: 2 },
	{ label: "a conversation bound to another service", overrides: { conversation: { agentServiceId: "service-2" } }, expectedLookupCount: 2 },
	{ label: "a missing run", overrides: { run: null }, expectedLookupCount: 3 },
	{ label: "a missing or non-personal service", overrides: { service: null }, expectedLookupCount: 4 },
	{ label: "a changed agent revision", overrides: { service: { activeRevisionId: "agent-2" } }, expectedLookupCount: 4 },
];

describe("PrismaPersonalConfigurationProposalRepository", function _PrismaPersonalConfigurationProposalRepositorySuite()
{
	it("reads every provenance fence in order before inserting exact immutable evidence", async function _PersistsBoundProposal()
	{
		const transaction = _transaction();
		const repository = new PrismaPersonalConfigurationProposalRepository(transaction as never);
		const result = await repository.propose(_command());

		expect(result).toEqual({ status: PersonalConfigurationProposalCodes.Proposed, changeId: "change-1" });
		expect(transaction.personaProfile.findFirst).toHaveBeenCalledWith({ where: { id: "profile-1", siloId: "silo-1", userId: "user-1" }, select: { activeRevisionId: true } });
		expect(transaction.conversation.findFirst).toHaveBeenCalledWith({ where: { id: "conversation-1", siloId: "silo-1", mode: ConversationMode.AgentSession, participants: { some: { userId: "user-1", accessEndedPosition: null } } }, select: { agentServiceId: true } });
		expect(transaction.agentRun.findFirst).toHaveBeenCalledWith({ where: { id: "run-1", siloId: "silo-1", conversationId: "conversation-1", agentServiceId: "service-1", delegatedUserId: "user-1" }, select: { id: true } });
		expect(transaction.agentService.findFirst).toHaveBeenCalledWith({ where: { id: "service-1", siloId: "silo-1", kind: AgentServiceKind.Personal }, select: { activeRevisionId: true } });
		expect(transaction.personalConfigurationChange.create).toHaveBeenCalledWith({
			data: {
				siloId: "silo-1",
				userId: "user-1",
				personaProfileId: "profile-1",
				agentServiceId: "service-1",
				sourceConversationId: "conversation-1",
				sourceRunId: "run-1",
				sourceMessageId: "message-1",
				requestedPatch: { kind: AgentConfigPatchKinds.ModelAlias, modelAlias: "careful-model" },
				requestedPatchDigest: `sha256:${"a".repeat(64)}`,
				expectedPersonaRevisionId: "persona-1",
				expectedAgentRevisionId: "agent-1",
				proposedAt: new Date("2026-07-23T00:00:00.000Z"),
			},
			select: { id: true },
		});
		expect(transaction.personaProfile.findFirst.mock.invocationCallOrder[0]).toBeLessThan(transaction.conversation.findFirst.mock.invocationCallOrder[0] ?? 0);
		expect(transaction.conversation.findFirst.mock.invocationCallOrder[0]).toBeLessThan(transaction.agentRun.findFirst.mock.invocationCallOrder[0] ?? 0);
		expect(transaction.agentRun.findFirst.mock.invocationCallOrder[0]).toBeLessThan(transaction.agentService.findFirst.mock.invocationCallOrder[0] ?? 0);
		expect(transaction.agentService.findFirst.mock.invocationCallOrder[0]).toBeLessThan(transaction.personalConfigurationChange.create.mock.invocationCallOrder[0] ?? 0);
	});

	it.each(_PROVENANCE_CONFLICTS)("fails closed after $label", async function _RejectsProvenanceConflict(testCase)
	{
		const transaction = _transaction(testCase.overrides);
		const repository = new PrismaPersonalConfigurationProposalRepository(transaction as never);
		const result = await repository.propose(_command());
		const lookups = [transaction.personaProfile.findFirst, transaction.conversation.findFirst, transaction.agentRun.findFirst, transaction.agentService.findFirst];

		expect(result).toEqual({ status: PersonalConfigurationProposalCodes.ProvenanceConflict });
		expect(lookups.reduce(function _CountCalls(count, lookup) { return count + lookup.mock.calls.length; }, 0)).toBe(testCase.expectedLookupCount);
		expect(transaction.personalConfigurationChange.create).not.toHaveBeenCalled();
	});
});
