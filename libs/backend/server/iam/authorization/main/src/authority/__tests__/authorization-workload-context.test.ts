import { describe, expect, it, vi } from "vitest";

import { AuthorizationBoundaryCoverages, AuthorizationBoundaryKinds, AuthorizationDecisionOutcomes, AuthorizationGrantEffects, AuthorizationSubjectKinds, ProductAuthorizationActions, ProductAuthorizationResourceKinds, __ProductAuthorizationCapability } from "@opencrane/models/authorization";

import { __AuthorizationAuthority } from "../authorization-authority";
import type { AdmitPrincipalProductAuthorizationCommand } from "../authorization-authority.types";

/** Keeps the policy Principal distinct from the verified physical actor and saved run. */
function _Fixture()
{
	const command: AdmitPrincipalProductAuthorizationCommand = {
		siloId: "silo-1", principalId: "principal-1", actorKind: "workload", actorId: "pod-1",
		workload: { audience: "audience-1", namespace: "namespace-1", serviceAccountName: "service-account-1", workloadKind: "job", workloadUid: "job-1", podUid: "pod-1" },
		run: { runId: "run-1", attempt: 1, agentServiceId: "service-1", agentRevisionId: "revision-1" },
		resource: { kind: ProductAuthorizationResourceKinds.McpToolRevision, id: "tool-1" }, action: ProductAuthorizationActions.Invoke, argumentsDigest: `sha256:${"a".repeat(64)}`, nowEpochMs: 1,
	};
	const capability = __ProductAuthorizationCapability(command.resource.kind, command.action)!;
	const repository = {
		resolvePrincipalSubjects: vi.fn().mockResolvedValue([{ kind: AuthorizationSubjectKinds.Principal, principalId: command.principalId }]),
		resolveBoundaryContext: vi.fn().mockResolvedValue({ requestedGroupAncestorIds: [] }),
		listSubjectGrants: vi.fn().mockResolvedValue([{ grantId: "grant-1", siloId: command.siloId, subject: { kind: AuthorizationSubjectKinds.Principal, principalId: command.principalId }, boundary: { kind: AuthorizationBoundaryKinds.Personal, principalId: command.principalId }, boundaryCoverage: AuthorizationBoundaryCoverages.Exact, capability, resource: command.resource, effect: AuthorizationGrantEffects.Allow, priority: 0, validFromEpochMs: 0, expiresAtEpochMs: null, revokedAtEpochMs: null }]),
	};
	const recorder = { record: vi.fn().mockResolvedValue(undefined) };
	return { command, repository, recorder, authority: new __AuthorizationAuthority(repository, recorder) };
}

describe("verified workload admission context", function _Suite()
{
	it.each(["audience", "namespace", "serviceAccountName", "workloadUid", "podUid"] as const)("rejects an empty %s before reading grants", async function _EmptyCoordinate(field)
	{
		const f = _Fixture();
		await expect(f.authority.admitPrincipal({ ...f.command, workload: { ...f.command.workload!, [field]: " " } })).rejects.toThrow("complete verified Pod identity");
		expect(f.repository.resolvePrincipalSubjects).not.toHaveBeenCalled();
		expect(f.recorder.record).not.toHaveBeenCalled();
	});

	it("refuses missing workload context through direct and batch admissions", async function _MissingContext()
	{
		const f = _Fixture();
		const invalid = { ...f.command, workload: undefined };
		await expect(f.authority.admitPrincipal(invalid)).rejects.toThrow("complete verified Pod identity");
		await expect(f.authority.admit({ ...invalid, boundary: { kind: AuthorizationBoundaryKinds.Personal, principalId: "principal-1" } })).rejects.toThrow("complete verified Pod identity");
		await expect(f.authority.admitPrincipalBatch([f.command, invalid])).rejects.toThrow("complete verified Pod identity");
		expect(f.repository.resolvePrincipalSubjects).not.toHaveBeenCalled();
		expect(f.recorder.record).not.toHaveBeenCalled();
	});

	it("refuses actor and Pod substitution, invented kinds and incoherent run coordinates", async function _Substitution()
	{
		const f = _Fixture();
		const invalid = [
			{ ...f.command, actorId: "principal-1" },
			{ ...f.command, actorKind: "user" as const },
			{ ...f.command, workload: { ...f.command.workload!, workloadKind: "pod" as const } },
			{ ...f.command, workload: { ...f.command.workload!, workloadKind: "invented" as never } },
			{ ...f.command, run: { ...f.command.run!, attempt: 0 } },
			{ ...f.command, run: { ...f.command.run!, agentRevisionId: "" } },
		];
		for (const command of invalid)
			await expect(f.authority.admitPrincipal(command)).rejects.toThrow("authorization");
		expect(f.repository.resolvePrincipalSubjects).not.toHaveBeenCalled();
	});

	it.each(["audience", "namespace", "serviceAccountName", "workloadUid", "podUid", "workloadKind"] as const)("binds %s into the durable evidence digest", async function _WorkloadDigest(field)
	{
		const f = _Fixture();
		const first = await f.authority.admitPrincipal(f.command);
		const value = field === "workloadKind" ? "deployment" : `different-${field}`;
		const workload = { ...f.command.workload!, [field]: value };
		const command = { ...f.command, workload, actorId: workload.podUid };
		const changed = await f.authority.admitPrincipal(command);
		expect(changed.outcome).toBe(AuthorizationDecisionOutcomes.Allow);
		expect(changed.evidence?.decisionDigest).not.toBe(first.evidence?.decisionDigest);
		expect(f.recorder.record).toHaveBeenLastCalledWith(expect.objectContaining({ principalId: "principal-1", actorId: workload.podUid, workload }), changed);
	});

	it.each(["runId", "attempt", "agentServiceId", "agentRevisionId"] as const)("binds the saved run's %s into the durable evidence digest", async function _RunDigest(field)
	{
		const f = _Fixture();
		const first = await f.authority.admitPrincipal(f.command);
		const value = field === "attempt" ? 2 : `different-${field}`;
		const changed = await f.authority.admitPrincipal({ ...f.command, run: { ...f.command.run!, [field]: value } });
		expect(changed.outcome).toBe(AuthorizationDecisionOutcomes.Allow);
		expect(changed.evidence?.decisionDigest).not.toBe(first.evidence?.decisionDigest);
	});

	it("admits the actual Pod object and keeps human admission free of workload metadata", async function _ActorKinds()
	{
		const f = _Fixture();
		await expect(f.authority.admitPrincipal({ ...f.command, workload: { ...f.command.workload!, workloadKind: "pod", workloadUid: "pod-1" } })).resolves.toMatchObject({ outcome: AuthorizationDecisionOutcomes.Allow });
		await expect(f.authority.admitPrincipal({ ...f.command, actorKind: "user", actorId: "principal-1", workload: undefined, run: undefined })).resolves.toMatchObject({ outcome: AuthorizationDecisionOutcomes.Allow });
	});
});
