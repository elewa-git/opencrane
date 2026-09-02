import { AgentIdentityStates, type ProxiedAgentIdentity } from "@opencrane/contracts";
import { HistoryExpectedRevisions } from "@opencrane/backend/server/infra/history-store";
import { describe, expect, it, vi } from "vitest";

import type { CurrentAgentIdentity } from "../agent-identity-history.types";
import { __ProxiedAgentIdentityId, ProxiedAgentIdentityHistoryProvisioner } from "../proxied-agent-identity-provisioner";

/** Builds trusted personal-agent facts after the caller and active revision were checked. */
function _Command(overrides: Partial<{ readonly siloId: string; readonly agentServiceId: string; readonly proxiedPrincipalId: string; readonly delegationPolicyId: string; readonly agentServiceName: string }> = {})
{
	return { siloId: "silo-1", agentServiceId: "service-1", proxiedPrincipalId: "principal-1", delegationPolicyId: "agent-revision:revision-1", agentServiceName: "Personal assistant", ...overrides };
}

/** Builds the exact active identity a personal service may hold for one user. */
function _Current(overrides: Partial<ProxiedAgentIdentity> = {}): CurrentAgentIdentity
{
	const identity: ProxiedAgentIdentity = { schemaVersion: 1, id: __ProxiedAgentIdentityId("service-1", "principal-1"), siloId: "silo-1", agentServiceId: "service-1", name: "Personal assistant", avatarArtifactRevisionId: null, state: AgentIdentityStates.Active, createdByPrincipalId: "principal-1", createdAt: "2026-09-02T00:00:00.000Z", kind: "proxied", proxiedPrincipalId: "principal-1", delegationPolicyId: "agent-revision:revision-1", ...overrides };
	return { streamName: `agent-identity-${identity.id}`, revision: 0n, headDigest: `sha256:${"a".repeat(64)}`, identity };
}

/** Builds the provisioner over a narrow identity history fake. */
function _Provisioner(load = vi.fn(), append = vi.fn())
{
	return { subject: new ProxiedAgentIdentityHistoryProvisioner({ load, append } as never, { now: () => new Date("2026-09-02T00:00:00.000Z") }), load, append };
}

describe("ProxiedAgentIdentityHistoryProvisioner", function _ProxiedAgentIdentityHistoryProvisionerSuite()
{
	it("derives different opaque keys for service and principal tuples that contain separators", function _SeparatesOpaqueCoordinates()
	{
		expect(__ProxiedAgentIdentityId("service:alice", "bob")).not.toEqual(__ProxiedAgentIdentityId("service", "alice:bob"));
	});

	it("anchors one deterministic personal-agent identity for its exact proxied user", async function _ProvisionsIdentity()
	{
		const { subject, load, append } = _Provisioner(vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce(_Current()), vi.fn().mockResolvedValue({ streamName: `agent-identity-${__ProxiedAgentIdentityId("service-1", "principal-1")}`, revision: 0n }));
		await expect(subject.ensure(_Command())).resolves.toEqual({ agentIdentityId: __ProxiedAgentIdentityId("service-1", "principal-1") });
		expect(append).toHaveBeenCalledWith(expect.objectContaining({ expectedRevision: HistoryExpectedRevisions.NoStream, identity: expect.objectContaining({ kind: "proxied", proxiedPrincipalId: "principal-1", delegationPolicyId: "agent-revision:revision-1" }) }));
		expect(load).toHaveBeenCalledTimes(2);
	});

	it("reuses only the matching active identity and recovers an append race", async function _ReusesOrRecovers()
	{
		const existing = _Provisioner(vi.fn().mockResolvedValue(_Current()));
		await expect(existing.subject.ensure(_Command())).resolves.toEqual({ agentIdentityId: __ProxiedAgentIdentityId("service-1", "principal-1") });
		expect(existing.append).not.toHaveBeenCalled();
		const race = _Provisioner(vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce(_Current()), vi.fn().mockRejectedValue(new Error("stale expected revision")));
		await expect(race.subject.ensure(_Command())).resolves.toEqual({ agentIdentityId: __ProxiedAgentIdentityId("service-1", "principal-1") });
	});

	it("fails closed for a different proxied user, policy, identity kind, or inactive stream", async function _RejectsConflicts()
	{
		for (const identity of [_Current({ proxiedPrincipalId: "principal-2" }), _Current({ delegationPolicyId: "agent-revision:revision-2" }), _Current({ kind: "managed" } as never), _Current({ state: AgentIdentityStates.Suspended })])
			await expect(_Provisioner(vi.fn().mockResolvedValue(identity)).subject.ensure(_Command())).rejects.toThrow("conflicting identity stream");
	});
});
