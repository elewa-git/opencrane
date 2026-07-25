import { PersonaRevisionState } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import { PrismaApprovedPersonaSource } from "../prisma-approved-persona-source.js";
import type { InitialRunAuthority, RunAdmissionTransaction } from "@opencrane/backend/agents/execution/runs";

/** Create a personal interactive run delegated to the current execution subject. */
function _PersonalRun(overrides: Partial<InitialRunAuthority> = {}): InitialRunAuthority
{
	return { agentServiceId: "service-1", agentRevisionId: "revision-1", agentKind: "personal", effectiveContractDigest: "sha256:contract", promptCompilerVersion: "v1", trigger: "interactive", delegatedUserId: "user-1", rootRunId: "run-1", parentRunId: null, ...overrides };
}

/** Create the narrow admission command whose subject owns the personal profile. */
function _Command(overrides: Record<string, unknown> = {})
{
	return { runId: "run-1", siloId: "silo-1", agentServiceId: "service-1", threadId: "thread-1", executionSubjectId: "user-1", requestIdempotencyKey: "request-1", ...overrides } as never;
}

/** Create the minimal transaction façade expected by this read-only authority source. */
function _Transaction(activeRevision: unknown): RunAdmissionTransaction
{
	return { prisma: { personaProfile: { findUnique: vi.fn().mockResolvedValue(activeRevision === undefined ? null : { activeRevision }) } } as never, admittedAt: "2026-07-25T00:00:00.000Z", admittedAtEpochMs: Date.parse("2026-07-25T00:00:00.000Z") };
}

describe("PrismaApprovedPersonaSource", function _DescribeApprovedPersonaSource()
{
	it("loads only the delegated user's currently approved profile revision in the command silo", async function _LoadsApprovedPersona()
	{
		const transaction = _Transaction({ id: "persona-1", state: PersonaRevisionState.Approved, personaProfileId: "profile-1" });
		const result = await new PrismaApprovedPersonaSource().load(_Command(), _PersonalRun(), transaction);

		expect(result).toEqual({ outcome: "loaded", value: { personaRevisionId: "persona-1" } });
		expect(transaction.prisma.personaProfile.findUnique).toHaveBeenCalledWith({ where: { siloId_userId: { siloId: "silo-1", userId: "user-1" } }, select: { activeRevision: { select: { id: true, state: true, personaProfileId: true } } } });
	});

	it("rejects a personal run whose delegated user does not match its authenticated execution subject", async function _RejectsImpersonation()
	{
		const transaction = _Transaction({ id: "persona-1", state: PersonaRevisionState.Approved, personaProfileId: "profile-1" });
		await expect(new PrismaApprovedPersonaSource().load(_Command({ executionSubjectId: "user-2" }), _PersonalRun(), transaction)).resolves.toEqual({ outcome: "denied", reason: "persona_unavailable" });
		expect(transaction.prisma.personaProfile.findUnique).not.toHaveBeenCalled();
	});

	it("rejects a missing or non-approved active revision instead of snapshotting a draft persona", async function _RejectsUnapprovedPersona()
	{
		await expect(new PrismaApprovedPersonaSource().load(_Command(), _PersonalRun(), _Transaction({ id: "persona-1", state: PersonaRevisionState.Draft, personaProfileId: "profile-1" }))).resolves.toEqual({ outcome: "denied", reason: "persona_unavailable" });
		await expect(new PrismaApprovedPersonaSource().load(_Command(), _PersonalRun(), _Transaction(null))).resolves.toEqual({ outcome: "denied", reason: "persona_unavailable" });
	});

	it("keeps managed runs persona-free without reading a personal profile", async function _KeepsManagedPersonaFree()
	{
		const transaction = _Transaction({ id: "persona-1", state: PersonaRevisionState.Approved, personaProfileId: "profile-1" });
		await expect(new PrismaApprovedPersonaSource().load(_Command(), _PersonalRun({ agentKind: "managed", delegatedUserId: null }), transaction)).resolves.toEqual({ outcome: "loaded", value: { personaRevisionId: null } });
		expect(transaction.prisma.personaProfile.findUnique).not.toHaveBeenCalled();
	});
});
