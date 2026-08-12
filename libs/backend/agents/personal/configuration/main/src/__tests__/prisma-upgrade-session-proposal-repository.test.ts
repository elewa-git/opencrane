import { createHash } from "node:crypto";

import { AgentConfigPatchKinds, type RunInputSnapshot, type RuntimeExternalActionCandidate } from "@opencrane/contracts";
import { ___CanonicalizeJson, type JsonValue } from "@opencrane/util";
import { describe, expect, it, vi } from "vitest";

import { PrismaUpgradeSessionProposalUnitOfWork } from "../upgrade-session/prisma-upgrade-session-proposal-repository.js";

/** Builds the run snapshot the adapter reads. */
function _snapshot(): RunInputSnapshot
{
	return { runId: "run-1", siloId: "silo-1", agentServiceId: "service-1", agentRevisionId: "agent-1", conversationId: "conversation-1", personaRevisionId: "persona-1", identitySnapshot: { kind: "user", executionSubjectId: "user-1" } } as unknown as RunInputSnapshot;
}

/** Build one valid model-selection candidate with its canonical argument digest. */
function _candidate(): RuntimeExternalActionCandidate
{
	const argumentsValue = { kind: AgentConfigPatchKinds.ModelAlias, modelAlias: "careful-model" } as const;
	const argumentsDigest = `sha256:${createHash("sha256").update(___CanonicalizeJson(argumentsValue as JsonValue), "utf8").digest("hex")}`;
	return { runId: "run-1", arguments: argumentsValue, argumentsDigest } as unknown as RuntimeExternalActionCandidate;
}

/** Builds the Prisma fakes for the profile lookup and the proposal insert. */
function _prisma(profile: { readonly id: string } | null = { id: "profile-1" })
{
	const transaction = {
		personaProfile: { findUnique: vi.fn(async function _findOwnerProfile() { return profile; }), findFirst: vi.fn(async function _findProfile() { return { activeRevisionId: "persona-1" }; }) },
		conversation: { findFirst: vi.fn(async function _findConversation() { return { agentServiceId: "service-1" }; }) },
		agentRun: { findFirst: vi.fn(async function _findRun() { return { id: "run-1" }; }) },
		agentService: { findFirst: vi.fn(async function _findService() { return { activeRevisionId: "agent-1" }; }) },
		personalConfigurationChange: { create: vi.fn(async function _create() { return { id: "change-1" }; }) },
	};
	return {
		transaction,
		client: { $transaction: vi.fn(async function _transaction(work: (value: unknown) => Promise<unknown>) { return work(transaction); }) },
	};
}

describe("Prisma upgrade-session proposal repository", function _PrismaUpgradeSessionProposalRepositorySuite()
{
	it("resolves the owner profile before delegating to the provenance-bound proposal UoW", async function _ProposesFutureChange()
	{
		const prisma = _prisma();
		const repository = new PrismaUpgradeSessionProposalUnitOfWork(prisma.client as never);
		await expect(repository.proposeUpgradeSession(_candidate(), _snapshot(), "2026-08-01T00:00:00.000Z")).resolves.toEqual({ changeId: "change-1" });
		expect(prisma.transaction.personalConfigurationChange.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ personaProfileId: "profile-1", sourceRunId: "run-1" }) }));
	});

	it("fails before proposal transaction creation when the personal profile is unavailable", async function _RejectsMissingProfile()
	{
		const prisma = _prisma(null);
		const repository = new PrismaUpgradeSessionProposalUnitOfWork(prisma.client as never);
		await expect(repository.proposeUpgradeSession(_candidate(), _snapshot(), "2026-08-01T00:00:00.000Z")).rejects.toThrow("personal profile is unavailable");
		expect(prisma.client.$transaction).toHaveBeenCalledOnce();
	});
});
