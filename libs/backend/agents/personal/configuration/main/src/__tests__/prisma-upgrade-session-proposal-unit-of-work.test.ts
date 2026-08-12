import { Prisma } from "@prisma/client";
import { AgentConfigPatchKinds, type RunInputSnapshot } from "@opencrane/contracts";
import { ___GetContext } from "@opencrane/backend/observability";
import type { JsonValue } from "@opencrane/util";
import { describe, expect, it, vi } from "vitest";

import { PersonalConfigurationProposalCodes } from "../proposal/personal-configuration-proposal.types.js";
import { PrismaUpgradeSessionProposalUnitOfWork } from "../upgrade-session/prisma-upgrade-session-proposal-unit-of-work.js";
import type { UpgradeSessionInvocation } from "../upgrade-session/upgrade-session.types.js";

/** Builds one durable admitted invocation, optionally replacing its protected arguments. */
function _candidate(argumentsValue: JsonValue = { kind: AgentConfigPatchKinds.ModelAlias, modelAlias: "careful-model" }): UpgradeSessionInvocation
{
	const candidate: UpgradeSessionInvocation = {
		runId: "run-1",
		attempt: 1,
		toolRevisionId: "upgrade-session-v1",
		toolInvocationId: "invocation-1",
		arguments: argumentsValue,
		argumentsDigest: "sha256:2f03c46815d8ef4662fd1544f939dd487e797baebec17c65b10742222a0a4406",
	};
	return candidate;
}

/** Builds one immutable snapshot with optional personal-conversation coordinates. */
function _snapshot(personaRevisionId: string | null = "persona-1", conversationId: string | null = "conversation-1"): RunInputSnapshot
{
	const snapshot = {
		runId: "run-1",
		siloId: "silo-1",
		agentServiceId: "service-1",
		agentRevisionId: "agent-1",
		conversationId,
		personaRevisionId,
		identitySnapshot: { kind: "user", executionSubjectId: "user-1" },
	} as unknown as RunInputSnapshot;
	return snapshot;
}

/** Builds the exact database seams used by the upgrade-session proposal transaction. */
function _database(ownerProfileId: string | null = "profile-1", createError: Error | null = null)
{
	let traceFields: Record<string, unknown> | undefined;
	const transaction = {
		personaProfile: {
			findUnique: vi.fn(async function _FindOwnerProfile() { return ownerProfileId === null ? null : { id: ownerProfileId }; }),
		},
		personalConfigurationChange: { create: vi.fn(async function _CreateProposal() { if (createError !== null) throw createError; return { id: "change-1" }; }) },
	};
	const prisma = { $transaction: vi.fn(async function _RunTransaction(work: (value: unknown) => Promise<unknown>) { traceFields = ___GetContext()?.extra; return work(transaction); }) };
	return { prisma, transaction, traceFields: function _TraceFields() { return traceFields; } };
}

/** Builds a logger double that captures the active trace context at failure time. */
function _logger()
{
	let traceFields: Record<string, unknown> | undefined;
	const error = vi.fn(function _LogError() { traceFields = ___GetContext()?.extra; });
	return { logger: { error }, error, traceFields: function _TraceFields() { return traceFields; } };
}

describe("Prisma upgrade-session proposal UoW", function _PrismaUpgradeSessionProposalUnitOfWorkSuite()
{
	it("keeps owner resolution and proposal persistence in one ordered transaction", async function _ProposesAtomically()
	{
		const database = _database();
		const logging = _logger();
		const unitOfWork = new PrismaUpgradeSessionProposalUnitOfWork(database.prisma as never, logging.logger as never);

		await expect(unitOfWork.proposeUpgradeSession(_candidate(), _snapshot(), "2026-08-01T00:00:00.000Z")).resolves.toEqual({ changeId: "change-1" });
		expect(database.prisma.$transaction).toHaveBeenCalledOnce();
		expect(database.traceFields()).toEqual({ operation: "personal_configuration.propose", siloId: "silo-1", userId: "user-1", sourceRunId: "run-1" });
		expect(logging.error).not.toHaveBeenCalled();
		expect(database.transaction.personaProfile.findUnique.mock.invocationCallOrder[0]).toBeLessThan(database.transaction.personalConfigurationChange.create.mock.invocationCallOrder[0] ?? 0);
	});

	it("rejects a snapshot without a personal revision before transaction creation", async function _RejectsMissingPersona()
	{
		const database = _database();
		const logging = _logger();
		const unitOfWork = new PrismaUpgradeSessionProposalUnitOfWork(database.prisma as never, logging.logger as never);

		await expect(unitOfWork.proposeUpgradeSession(_candidate(), _snapshot(null), "2026-08-01T00:00:00.000Z")).rejects.toThrow("requires a personal conversation snapshot");
		expect(database.prisma.$transaction).not.toHaveBeenCalled();
		expect(logging.error).not.toHaveBeenCalled();
	});

	it("rejects a snapshot without a conversation before transaction creation", async function _RejectsMissingConversation()
	{
		const database = _database();
		const logging = _logger();
		const unitOfWork = new PrismaUpgradeSessionProposalUnitOfWork(database.prisma as never, logging.logger as never);

		await expect(unitOfWork.proposeUpgradeSession(_candidate(), _snapshot("persona-1", null), "2026-08-01T00:00:00.000Z")).rejects.toThrow("requires a personal conversation snapshot");
		expect(database.prisma.$transaction).not.toHaveBeenCalled();
		expect(logging.error).not.toHaveBeenCalled();
	});

	it("rejects unsupported patch arguments before transaction creation", async function _RejectsUnsupportedPatch()
	{
		const database = _database();
		const logging = _logger();
		const unitOfWork = new PrismaUpgradeSessionProposalUnitOfWork(database.prisma as never, logging.logger as never);

		await expect(unitOfWork.proposeUpgradeSession(_candidate({ kind: "unknown" }), _snapshot(), "2026-08-01T00:00:00.000Z")).rejects.toThrow("supported configuration patch");
		expect(database.prisma.$transaction).not.toHaveBeenCalled();
		expect(logging.error).not.toHaveBeenCalled();
	});

	it("reports an unavailable owner profile without attempting the proposal insert", async function _RejectsMissingProfile()
	{
		const database = _database(null);
		const logging = _logger();
		const unitOfWork = new PrismaUpgradeSessionProposalUnitOfWork(database.prisma as never, logging.logger as never);

		await expect(unitOfWork.proposeUpgradeSession(_candidate(), _snapshot(), "2026-08-01T00:00:00.000Z")).rejects.toThrow("personal profile is unavailable");
		expect(database.transaction.personalConfigurationChange.create).not.toHaveBeenCalled();
		expect(logging.error).not.toHaveBeenCalled();
	});

	it("maps the database trigger fence to the same provenance denial", async function _MapsTriggerFence()
	{
		const conflict = new Prisma.PrismaClientKnownRequestError("proposal provenance conflict", { code: "P0001", clientVersion: "test" });
		const database = _database("profile-1", conflict);
		const logging = _logger();
		const unitOfWork = new PrismaUpgradeSessionProposalUnitOfWork(database.prisma as never, logging.logger as never);

		await expect(unitOfWork.proposeUpgradeSession(_candidate(), _snapshot(), "2026-08-01T00:00:00.000Z")).rejects.toThrow(`proposal denied: ${PersonalConfigurationProposalCodes.ProvenanceConflict}`);
		expect(logging.error).toHaveBeenCalledOnce();
		expect(logging.error).toHaveBeenCalledWith({ err: conflict, operation: "personal_configuration.propose", siloId: "silo-1", sourceRunId: "run-1" }, "Personal configuration proposal persistence failed");
		expect(logging.traceFields()).toEqual({ operation: "personal_configuration.propose", siloId: "silo-1", userId: "user-1", sourceRunId: "run-1" });
	});

	it("maps an unexpected transaction failure to persistence unavailability", async function _MapsPersistenceFailure()
	{
		const database = _database();
		const logging = _logger();
		const error = new Error("connection unavailable");
		database.prisma.$transaction.mockRejectedValue(error);
		const unitOfWork = new PrismaUpgradeSessionProposalUnitOfWork(database.prisma as never, logging.logger as never);

		await expect(unitOfWork.proposeUpgradeSession(_candidate(), _snapshot(), "2026-08-01T00:00:00.000Z")).rejects.toThrow(`proposal denied: ${PersonalConfigurationProposalCodes.PersistenceUnavailable}`);
		expect(logging.error).toHaveBeenCalledOnce();
		expect(logging.error).toHaveBeenCalledWith({ err: error, operation: "personal_configuration.propose", siloId: "silo-1", sourceRunId: "run-1" }, "Personal configuration proposal persistence failed");
		expect(logging.traceFields()).toEqual({ operation: "personal_configuration.propose", siloId: "silo-1", userId: "user-1", sourceRunId: "run-1" });
	});
});
