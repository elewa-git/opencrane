import { PersonaRevisionState } from "@prisma/client";
import { AgentServiceKinds } from "@opencrane/models/agents";
import type { InitialRunAuthority, RunAdmissionTransaction } from "@opencrane/backend/agents/execution/runs";
import { describe, expect, it, vi } from "vitest";

import { PrismaApprovedPersonaSource } from "../prisma-approved-persona-source";

/** Creates personal run authority bound to its delegated owner. */
function _PersonalRun(overrides: Partial<InitialRunAuthority> = {}): InitialRunAuthority
{
	return { agentServiceId: "service-1", agentRevisionId: "revision-1", agentKind: AgentServiceKinds.Personal, effectiveContractDigest: "sha256:contract", promptCompilerVersion: "v1", trigger: "interactive", delegatedUserId: "user-1", rootRunId: "run-1", parentRunId: null, ...overrides };
}

/** Creates the command whose subject owns the persona profile. */
function _Command(overrides: Record<string, unknown> = {})
{
	return { runId: "run-1", siloId: "silo-1", agentServiceId: "service-1", conversationId: null, identityKind: "user", trigger: "interactive", executionSubjectId: "user-1", requestIdempotencyKey: "request-1", ...overrides } as never;
}

/** Creates the admission transaction facade for persona profile lookup. */
function _Transaction(activeRevision: unknown): RunAdmissionTransaction
{
	return { prisma: { personaProfile: { findUnique: vi.fn().mockResolvedValue(activeRevision === undefined ? null : { activeRevision }) } } as never, admittedAt: "2026-07-26T00:00:00.000Z", admittedAtEpochMs: Date.parse("2026-07-26T00:00:00.000Z") };
}

describe("PrismaApprovedPersonaSource", function _DescribePrismaApprovedPersonaSource()
{
	it("loads only the delegated user's approved active persona in the command silo", async function _LoadsApprovedPersona()
	{
		const transaction = _Transaction({ id: "persona-1", state: PersonaRevisionState.Approved, personaProfileId: "profile-1" });
		await expect(new PrismaApprovedPersonaSource().load(_Command(), _PersonalRun(), transaction)).resolves.toEqual({ outcome: "loaded", value: { personaRevisionId: "persona-1", personaId: "profile-1" } });
		expect(transaction.prisma.personaProfile.findUnique).toHaveBeenCalledWith({ where: { siloId_userId: { siloId: "silo-1", userId: "user-1" } }, select: { activeRevision: { select: { id: true, state: true, personaProfileId: true } } } });
	});

	it("refuses cross-subject persona selection and keeps managed runs persona-free", async function _RejectsImpersonation()
	{
		const transaction = _Transaction({ id: "persona-1", state: PersonaRevisionState.Approved, personaProfileId: "profile-1" });
		await expect(new PrismaApprovedPersonaSource().load(_Command({ executionSubjectId: "user-2" }), _PersonalRun(), transaction)).resolves.toEqual({ outcome: "denied", reason: "persona_unavailable" });
		await expect(new PrismaApprovedPersonaSource().load(_Command(), _PersonalRun({ agentKind: AgentServiceKinds.Managed, delegatedUserId: null }), transaction)).resolves.toEqual({ outcome: "loaded", value: { personaRevisionId: null, personaId: null } });
	});

	it("refuses a missing or non-approved active revision", async function _RejectsDraftPersona()
	{
		await expect(new PrismaApprovedPersonaSource().load(_Command(), _PersonalRun(), _Transaction(null))).resolves.toEqual({ outcome: "denied", reason: "persona_unavailable" });
		await expect(new PrismaApprovedPersonaSource().load(_Command(), _PersonalRun(), _Transaction({ id: "persona-1", state: PersonaRevisionState.Draft, personaProfileId: "profile-1" }))).resolves.toEqual({ outcome: "denied", reason: "persona_unavailable" });
	});
});
