import { Prisma } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import { ConversationAgentBindingAuthority } from "../conversation-agent-binding-authority";
import { ConversationAgentBindingDenialReasons, type ConversationAgentBindingAuthorityDependencies, type ConversationAgentBindingCandidate } from "../conversation-agent-binding.types";
import { PrismaConversationAgentBindingRepository } from "../db/prisma-conversation-agent-binding-repository";
import { PrismaConversationAgentBindingUnitOfWork } from "../db/prisma-conversation-agent-binding-unit-of-work";

/** Builds one checked managed service candidate with its deterministic Principal contract. */
function _ManagedCandidate(overrides: Partial<ConversationAgentBindingCandidate> = {}): ConversationAgentBindingCandidate
{
	return { agentServiceId: "service-1", agentRevisionId: "revision-1", agentServiceKind: "managed", principalId: "managed-principal:service-1", principal: { issuer: "urn:opencrane:managed-agent", provenance: "internal", subject: "service-1" }, ...overrides };
}

/** Builds the deployment and identity selection ports without introducing a database fallback. */
function _Dependencies(): ConversationAgentBindingAuthorityDependencies
{
	return {
		profiles: { select: vi.fn().mockResolvedValue({ profileRevisionId: "profile-1" }) },
		identities: { select: vi.fn().mockResolvedValue({ agentIdentityId: "identity-1" }) },
	};
}

describe("ConversationAgentBindingAuthority", function _ConversationAgentBindingAuthoritySuite()
{
	it("binds only one active managed service to its revision, principal, selected identity, and release profile", async function _BindsManagedService()
	{
		const load = vi.fn().mockResolvedValue(_ManagedCandidate());
		const dependencies = _Dependencies();
		const result = await new ConversationAgentBindingAuthority({ load }, dependencies).bind({ siloId: "silo-1", agentServiceId: "service-1" });

		expect(result).toEqual({ outcome: "bound", value: { agentServiceId: "service-1", agentRevisionId: "revision-1", agentServiceKind: "managed", principalId: "managed-principal:service-1", agentIdentityId: "identity-1", profileRevisionId: "profile-1" } });
		expect(dependencies.profiles.select).toHaveBeenCalledWith({ siloId: "silo-1", agentServiceKind: "managed" });
		expect(dependencies.identities.select).toHaveBeenCalledWith({ siloId: "silo-1", agentServiceId: "service-1", principalId: "managed-principal:service-1" });
	});

	it("fails closed for a missing service, malformed managed Principal, missing release profile, and missing identity", async function _RejectsIncompleteCoordinates()
	{
		const dependencies = _Dependencies();
		await expect(new ConversationAgentBindingAuthority({ load: vi.fn().mockResolvedValue(null) }, dependencies).bind({ siloId: "silo-1", agentServiceId: "service-1" })).resolves.toEqual({ outcome: "denied", reason: ConversationAgentBindingDenialReasons.ServiceUnavailable });
		await expect(new ConversationAgentBindingAuthority({ load: vi.fn().mockResolvedValue(_ManagedCandidate({ principalId: "forged" })) }, dependencies).bind({ siloId: "silo-1", agentServiceId: "service-1" })).resolves.toEqual({ outcome: "denied", reason: ConversationAgentBindingDenialReasons.ManagedPrincipalUnavailable });
		(dependencies.profiles.select as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);
		await expect(new ConversationAgentBindingAuthority({ load: vi.fn().mockResolvedValue(_ManagedCandidate()) }, dependencies).bind({ siloId: "silo-1", agentServiceId: "service-1" })).resolves.toEqual({ outcome: "denied", reason: ConversationAgentBindingDenialReasons.ProfileUnavailable });
		(dependencies.identities.select as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);
		await expect(new ConversationAgentBindingAuthority({ load: vi.fn().mockResolvedValue(_ManagedCandidate()) }, dependencies).bind({ siloId: "silo-1", agentServiceId: "service-1" })).resolves.toEqual({ outcome: "denied", reason: ConversationAgentBindingDenialReasons.IdentityUnavailable });
	});

	it("refuses a personal service until a real owned-personal delegation policy can create its proxied identity", async function _RejectsPersonalService()
	{
		const dependencies = _Dependencies();
		const result = await new ConversationAgentBindingAuthority({ load: vi.fn().mockResolvedValue(_ManagedCandidate({ agentServiceKind: "personal", principalId: null, principal: null })) }, dependencies).bind({ siloId: "silo-1", agentServiceId: "service-1" });

		expect(result).toEqual({ outcome: "denied", reason: ConversationAgentBindingDenialReasons.PersonalDelegationUnavailable });
		expect(dependencies.profiles.select).not.toHaveBeenCalled();
		expect(dependencies.identities.select).not.toHaveBeenCalled();
	});
});

describe("PrismaConversationAgentBindingRepository", function _PrismaConversationAgentBindingRepositorySuite()
{
	it("queries an active service only through its matching published active revision", async function _LoadsPublishedActiveRevision()
	{
		const findFirst = vi.fn().mockResolvedValue({ id: "service-1", kind: "Managed", activeRevisionId: "revision-1", activeRevision: { id: "revision-1" }, principalId: "managed-principal:service-1", principal: { issuer: "urn:opencrane:managed-agent", provenance: "Internal", subject: "service-1" } });
		const result = await new PrismaConversationAgentBindingRepository({ agentService: { findFirst } } as never).load({ siloId: "silo-1", agentServiceId: "service-1" });

		expect(result).toEqual(_ManagedCandidate());
		expect(findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ id: "service-1", siloId: "silo-1", state: "Active", activeRevision: { is: { siloId: "silo-1", state: "Published" } } }) }));
	});

	it("uses a serializable transaction for the final binding snapshot", async function _UsesSerializableTransaction()
	{
		const transaction = { agentService: { findFirst: vi.fn().mockResolvedValue({ id: "service-1", kind: "Managed", activeRevisionId: "revision-1", activeRevision: { id: "revision-1" }, principalId: "managed-principal:service-1", principal: { issuer: "urn:opencrane:managed-agent", provenance: "Internal", subject: "service-1" } }) } };
		const $transaction = vi.fn(async function _Transaction(work, options)
		{
			expect(options).toEqual({ isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
			return work(transaction);
		});
		await expect(new PrismaConversationAgentBindingUnitOfWork({ $transaction } as never, _Dependencies()).bind({ siloId: "silo-1", agentServiceId: "service-1" })).resolves.toMatchObject({ outcome: "bound" });
	});
});
