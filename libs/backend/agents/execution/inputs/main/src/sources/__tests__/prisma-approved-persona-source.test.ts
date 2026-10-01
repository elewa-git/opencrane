import { PersonaRevisionState } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import { RunExecutionPersonalMemoryPolicies, RunExecutionPersonaPolicies } from "@opencrane/backend/agents/execution/runs";

import { PrismaApprovedPersonaAuthority } from "../prisma-approved-persona-source";

/** Keeps the sign-in subject, local Principal and request subject visibly distinct. */
function _Fixture()
{
	const prisma = {
		principal: { findUnique: vi.fn().mockResolvedValue({ subject: "approved-owner-oidc-subject" }) },
		personaProfile: { findUnique: vi.fn().mockResolvedValue({ activeRevision: { id: "approved-revision", state: PersonaRevisionState.Approved, personaProfileId: "owner-profile" } }) },
	};
	const command = { siloId: "silo-1", requester: { subjectId: "caller-supplied-other-subject" } } as never;
	const run = { executionPolicy: { persona: RunExecutionPersonaPolicies.Required, personalMemory: RunExecutionPersonalMemoryPolicies.None } } as never;
	const subject = { principalId: "local-principal", siloId: "silo-1" } as never;
	return { prisma, source: new PrismaApprovedPersonaAuthority(prisma as never), command, run, subject };
}

describe("PrismaApprovedPersonaAuthority", function _Suite()
{
	it("uses the verified Principal's same-silo sign-in subject to find the approved profile", async function _ResolvesOwner()
	{
		const fixture = _Fixture();
		await expect(fixture.source.load(fixture.command, fixture.run, fixture.subject, {} as never)).resolves.toEqual({ outcome: "loaded", value: { personaRevisionId: "approved-revision", personaId: "owner-profile" } });
		expect(fixture.prisma.principal.findUnique).toHaveBeenCalledWith({ where: { id_siloId: { id: "local-principal", siloId: "silo-1" } }, select: { subject: true } });
		expect(fixture.prisma.personaProfile.findUnique).toHaveBeenCalledWith({ where: { siloId_userId: { siloId: "silo-1", userId: "approved-owner-oidc-subject" } }, select: { activeRevision: { select: { id: true, state: true, personaProfileId: true } } } });
	});

	it.each([null, { subject: "" }, { subject: "  " }])("denies a missing Principal or blank sign-in subject before reading profiles: %j", async function _RefusesMissingPrincipal(principal)
	{
		const fixture = _Fixture();
		fixture.prisma.principal.findUnique.mockResolvedValue(principal);
		await expect(fixture.source.load(fixture.command, fixture.run, fixture.subject, {} as never)).resolves.toEqual({ outcome: "denied", reason: "persona_unavailable" });
		expect(fixture.prisma.personaProfile.findUnique).not.toHaveBeenCalled();
	});

	it("cannot resolve a Principal that exists only in another silo", async function _RefusesForeignPrincipal()
	{
		const fixture = _Fixture();
		fixture.prisma.principal.findUnique.mockImplementation(async function _FindPrincipal(query)
		{
			return query.where.id_siloId.siloId === "other-silo" ? { subject: "foreign-owner" } : null;
		});
		await expect(fixture.source.load(fixture.command, fixture.run, fixture.subject, {} as never)).resolves.toEqual({ outcome: "denied", reason: "persona_unavailable" });
		expect(fixture.prisma.personaProfile.findUnique).not.toHaveBeenCalled();
	});

	it.each([null, { activeRevision: null }, { activeRevision: { id: "draft-revision", state: PersonaRevisionState.Draft, personaProfileId: "owner-profile" } }])("still denies a missing or unapproved active persona: %j", async function _RefusesUnapproved(profile)
	{
		const fixture = _Fixture();
		fixture.prisma.personaProfile.findUnique.mockResolvedValue(profile);
		await expect(fixture.source.load(fixture.command, fixture.run, fixture.subject, {} as never)).resolves.toEqual({ outcome: "denied", reason: "persona_unavailable" });
	});

	it("does not read personal identity or profiles for a policy without a persona", async function _SkipsPersona()
	{
		const fixture = _Fixture();
		await expect(fixture.source.load(fixture.command, { executionPolicy: { persona: RunExecutionPersonaPolicies.None } } as never, fixture.subject, {} as never)).resolves.toEqual({ outcome: "loaded", value: { personaRevisionId: null, personaId: null } });
		expect(fixture.prisma.principal.findUnique).not.toHaveBeenCalled();
		expect(fixture.prisma.personaProfile.findUnique).not.toHaveBeenCalled();
	});
});
