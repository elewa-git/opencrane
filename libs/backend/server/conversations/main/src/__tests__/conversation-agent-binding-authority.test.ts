import { Prisma } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import { ConversationAgentBindingResolver, ConversationAgentBindingVerificationResolver } from "../conversation-agent-binding-authority";
import { ConversationAgentBindingDenialReasons, type ConversationAgentBindingAuthorityDependencies, type ConversationAgentBindingCandidate, type ConversationManagedAgentPrincipalValidator } from "../conversation-agent-binding.types";
import { PrismaConversationAgentBindingUnitOfWork } from "../db/prisma-conversation-agent-binding-unit-of-work";

function _Candidate(overrides: Partial<ConversationAgentBindingCandidate> = {}): ConversationAgentBindingCandidate
{
	return { agentServiceName: "Research", agentServiceId: "service-1", agentRevisionId: "revision-1", agentServiceKind: "managed", principalId: "managed-principal:service-1", principal: { issuer: "urn:opencrane:managed-agent", provenance: "internal", subject: "service-1" }, ...overrides };
}

function _Validator(): ConversationManagedAgentPrincipalValidator
{
	return { validate: vi.fn(command => command.principalId === `managed-principal:${command.agentServiceId}` && command.issuer === "urn:opencrane:managed-agent" && command.provenance === "internal" && command.subject === command.agentServiceId) };
}

function _Dependencies(): ConversationAgentBindingAuthorityDependencies
{
	return { profiles: { select: vi.fn().mockResolvedValue({ profileRevisionId: "profile-1" }) }, identities: { ensure: vi.fn().mockResolvedValue({ agentIdentityId: "identity-1" }) } };
}

describe("ConversationAgentBindingResolver", function _Suite()
{
	it("resolves external profile and identity only from a verified managed snapshot", async function _Resolves()
	{
		const dependencies = _Dependencies();
		const verifier = { verify: vi.fn().mockResolvedValue({ outcome: "verified", value: _Candidate() }) };
		await expect(new ConversationAgentBindingResolver(verifier, dependencies).bind({ siloId: "silo-1", agentServiceId: "service-1" })).resolves.toMatchObject({ outcome: "bound" });
		expect(dependencies.identities.ensure).toHaveBeenCalledWith({ siloId: "silo-1", agentServiceId: "service-1", principalId: "managed-principal:service-1", agentServiceName: "Research" });
	});

	it("does not invoke external selectors after a verifier denial", async function _Denies()
	{
		const dependencies = _Dependencies();
		await expect(new ConversationAgentBindingResolver({ verify: vi.fn().mockResolvedValue({ outcome: "denied", reason: ConversationAgentBindingDenialReasons.ServiceUnavailable }) }, dependencies).bind({ siloId: "silo-1", agentServiceId: "service-1" })).resolves.toEqual({ outcome: "denied", reason: ConversationAgentBindingDenialReasons.ServiceUnavailable });
		expect(dependencies.profiles.select).not.toHaveBeenCalled();
		expect(dependencies.identities.ensure).not.toHaveBeenCalled();
	});

	it("verifies a personal service before external resolution", async function _Verifies()
	{
		const verifier = new ConversationAgentBindingVerificationResolver({ load: vi.fn().mockResolvedValue(_Candidate({ agentServiceKind: "personal", principalId: null, principal: null })) }, _Validator());
		await expect(verifier.verify({ siloId: "silo-1", agentServiceId: "service-1" })).resolves.toEqual({ outcome: "denied", reason: ConversationAgentBindingDenialReasons.PersonalDelegationUnavailable });
	});

	it("closes the serializable SQL transaction before the outer resolver is invoked", async function _ClosesTransaction()
	{
		const phases: string[] = [];
		const transaction = { agentService: { findFirst: vi.fn().mockResolvedValue({ id: "service-1", name: "Research", kind: "Managed", activeRevisionId: "revision-1", activeRevision: { id: "revision-1" }, principalId: "managed-principal:service-1", principal: { issuer: "urn:opencrane:managed-agent", provenance: "Internal", subject: "service-1" } }) } };
		const $transaction = vi.fn(async function _Transaction(work, options) { expect(options).toEqual({ isolationLevel: Prisma.TransactionIsolationLevel.Serializable }); phases.push("opened"); const result = await work(transaction); phases.push("closed"); return result; });
		const verified = await new PrismaConversationAgentBindingUnitOfWork({ $transaction } as never, _Validator()).verify({ siloId: "silo-1", agentServiceId: "service-1" });
		expect(phases).toEqual(["opened", "closed"]);
		expect(verified).toMatchObject({ outcome: "verified" });
	});
});
