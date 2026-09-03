import { AgentIdentityStates, type ManagedAgentIdentity } from "@opencrane/contracts";
import { HistoryExpectedRevisions } from "@opencrane/backend/server/infra/history-store";
import { describe, expect, it, vi } from "vitest";

import type { CurrentAgentIdentity } from "../agent-identity-history.types";
import { __ManagedAgentIdentityId, ManagedAgentIdentityHistoryProvisioner } from "../managed-agent-identity-provisioner";

/** Builds service facts already verified by the AgentService and conversation binding authorities. */
function _Command(overrides: Partial<{ readonly siloId: string; readonly agentServiceId: string; readonly principalId: string; readonly agentServiceName: string }> = {})
{
	return { siloId: "silo-1", agentServiceId: "service-1", principalId: "managed-principal:service-1", agentServiceName: "Research assistant", ...overrides };
}

/** Builds the exact active identity this service may own. */
function _Current(overrides: Partial<ManagedAgentIdentity> = {}): CurrentAgentIdentity
{
	const identity: ManagedAgentIdentity = {
		schemaVersion: 1,
		id: __ManagedAgentIdentityId("service-1"),
		siloId: "silo-1",
		agentServiceId: "service-1",
		name: "Research assistant",
		avatarArtifactRevisionId: null,
		state: AgentIdentityStates.Active,
		createdByPrincipalId: "managed-principal:service-1",
		createdAt: "2026-09-02T00:00:00.000Z",
		kind: "managed",
		principalId: "managed-principal:service-1",
		...overrides,
	};
	return { streamName: `agent-identity-${identity.id}`, revision: 0n, headDigest: `sha256:${"a".repeat(64)}`, identity };
}

/** Builds the provisioner over a narrow history fake; the history authority owns stream validation. */
function _Provisioner(load = vi.fn(), append = vi.fn())
{
	return { subject: new ManagedAgentIdentityHistoryProvisioner({ load, append } as never, { now: () => new Date("2026-09-02T00:00:00.000Z") }), load, append };
}

describe("ManagedAgentIdentityHistoryProvisioner", function _ManagedAgentIdentityHistoryProvisionerSuite()
{
	it("anchors one deterministic active managed identity at revision zero when the stream is absent", async function _ProvisionsIdentity()
	{
		const { subject, load, append } = _Provisioner(vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce(_Current()), vi.fn().mockResolvedValue({ streamName: `agent-identity-${__ManagedAgentIdentityId("service-1")}`, revision: 0n }));

		await expect(subject.ensure(_Command())).resolves.toEqual({ agentIdentityId: __ManagedAgentIdentityId("service-1") });
		expect(append).toHaveBeenCalledWith(expect.objectContaining({ expectedRevision: HistoryExpectedRevisions.NoStream, identity: expect.objectContaining({ id: __ManagedAgentIdentityId("service-1"), kind: "managed", state: AgentIdentityStates.Active, principalId: "managed-principal:service-1", createdByPrincipalId: "managed-principal:service-1", avatarArtifactRevisionId: null }) }));
		expect(load).toHaveBeenCalledTimes(2);
	});

	it("reuses only a matching existing active managed stream and reloads one append race", async function _ReusesOrReloads()
	{
		const existing = _Provisioner(vi.fn().mockResolvedValue(_Current()));
		await expect(existing.subject.ensure(_Command())).resolves.toEqual({ agentIdentityId: __ManagedAgentIdentityId("service-1") });
		expect(existing.append).not.toHaveBeenCalled();

		const race = _Provisioner(vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce(_Current()), vi.fn().mockRejectedValue(new Error("stale expected revision")));
		await expect(race.subject.ensure(_Command())).resolves.toEqual({ agentIdentityId: __ManagedAgentIdentityId("service-1") });
	});

	it("rejects missing post-append history and a non-managed, suspended, or conflicting stream", async function _RejectsConflictingIdentity()
	{
		const missing = _Provisioner(vi.fn().mockResolvedValue(null), vi.fn().mockResolvedValue({ streamName: "agent-identity-any", revision: 0n }));
		await expect(missing.subject.ensure(_Command())).rejects.toThrow("did not persist");
		for (const identity of [_Current({ kind: "managed_subchat" } as never), _Current({ state: AgentIdentityStates.Suspended }), _Current({ principalId: "managed-principal:other" })])
			await expect(_Provisioner(vi.fn().mockResolvedValue(identity)).subject.ensure(_Command())).rejects.toThrow();
	});
});
