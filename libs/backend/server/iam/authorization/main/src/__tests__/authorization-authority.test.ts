import { AuthorizationBoundaryCoverages, AuthorizationBoundaryKinds, AuthorizationDecisionOutcomes, AuthorizationGrantEffects, AuthorizationSubjectKinds, ProductAuthorizationActions, ProductAuthorizationEvidenceKinds, ProductAuthorizationResourceKinds, __ProductAuthorizationCapability } from "@opencrane/models/authorization";
import { describe, expect, it, vi } from "vitest";

import { __AuthorizationAuthority } from "../authorization-authority";
import type { ProductAuthorizationDecisionRecorder } from "../authorization-authority.types";
import type { ManagedAuthorizationGrantRepository } from "../managed-authorization-grants.types";
import type { AuthorizationContextRepository } from "../authorization-resolution.types";

/** Builds an in-memory repository whose calls reveal whether batch decisions reuse context. */
function _Repository(): AuthorizationContextRepository
{
	const capability = __ProductAuthorizationCapability(ProductAuthorizationResourceKinds.Skill, ProductAuthorizationActions.Discover);
	if (capability === null)
	{
		throw new Error("skill discovery capability is missing from the product catalogue");
	}
	return {
		resolvePrincipalSubjects: vi.fn().mockResolvedValue([{ kind: AuthorizationSubjectKinds.Principal, principalId: "principal-1" }]),
		resolveBoundaryContext: vi.fn().mockResolvedValue({ requestedGroupAncestorIds: [] }),
		listSubjectGrants: vi.fn().mockResolvedValue([{
			grantId: "grant-1",
			siloId: "silo-1",
			subject: { kind: AuthorizationSubjectKinds.Principal, principalId: "principal-1" },
			boundary: { kind: AuthorizationBoundaryKinds.Personal, principalId: "principal-1" },
			boundaryCoverage: AuthorizationBoundaryCoverages.Exact,
			capability,
			resource: { kind: ProductAuthorizationResourceKinds.Skill, id: "skill-allowed" },
			effect: AuthorizationGrantEffects.Allow,
			priority: 10,
			validFromEpochMs: 0,
			expiresAtEpochMs: null,
			revokedAtEpochMs: null,
		}]),
	};
}

describe("central authorization authority", function _Suite()
{
	it("denies a resource-action pair absent from the typed catalogue without reading grants", async function _UnsupportedAction()
	{
		const repository = _Repository();
		const authority = new __AuthorizationAuthority(repository);
		const decision = await authority.decide({ siloId: "silo-1", principalId: "principal-1", boundary: { kind: AuthorizationBoundaryKinds.Personal, principalId: "principal-1" }, resource: { kind: ProductAuthorizationResourceKinds.Group, id: "group-1" }, action: ProductAuthorizationActions.Invoke, nowEpochMs: 1 });
		expect(decision).toEqual({ outcome: AuthorizationDecisionOutcomes.Deny, reason: "no_matching_grant", grantIds: [], rule: null });
		expect(repository.resolvePrincipalSubjects).not.toHaveBeenCalled();
	});

	it("returns the winning grant and catalogue evidence for one allowed decision", async function _AllowedDecision()
	{
		const repository = _Repository();
		const authority = new __AuthorizationAuthority(repository);
		const decision = await authority.decide({ siloId: "silo-1", principalId: "principal-1", boundary: { kind: AuthorizationBoundaryKinds.Personal, principalId: "principal-1" }, resource: { kind: ProductAuthorizationResourceKinds.Skill, id: "skill-allowed" }, action: ProductAuthorizationActions.Discover, nowEpochMs: 1 });
		expect(decision).toMatchObject({ outcome: AuthorizationDecisionOutcomes.Allow, grantIds: ["grant-1"], rule: { evidence: ProductAuthorizationEvidenceKinds.Read } });
	});

	it("requires a descendants grant before assigning a Group subtree", async function _DescendantsCoverage()
	{
		const repository = _Repository();
		const capability = __ProductAuthorizationCapability(ProductAuthorizationResourceKinds.AgentRevision, ProductAuthorizationActions.Assign);
		if (capability === null)
			throw new Error("agent revision assignment capability is missing");
		vi.mocked(repository.listSubjectGrants).mockResolvedValue([{ grantId: "grant-exact", siloId: "silo-1", subject: { kind: AuthorizationSubjectKinds.Principal, principalId: "principal-1" }, boundary: { kind: AuthorizationBoundaryKinds.Group, groupId: "group-1" }, boundaryCoverage: AuthorizationBoundaryCoverages.Exact, capability, resource: { kind: ProductAuthorizationResourceKinds.AgentRevision, id: "revision-1" }, effect: AuthorizationGrantEffects.Allow, priority: 10, validFromEpochMs: 0, expiresAtEpochMs: null, revokedAtEpochMs: null }]);
		const authority = new __AuthorizationAuthority(repository);
		const command = { siloId: "silo-1", principalId: "principal-1", boundary: { kind: AuthorizationBoundaryKinds.Group, groupId: "group-1" } as const, requiredBoundaryCoverage: AuthorizationBoundaryCoverages.Descendants, resource: { kind: ProductAuthorizationResourceKinds.AgentRevision, id: "revision-1" }, action: ProductAuthorizationActions.Assign, nowEpochMs: 1 };
		await expect(authority.decide(command)).resolves.toMatchObject({ outcome: AuthorizationDecisionOutcomes.Deny, reason: "insufficient_boundary_coverage" });
		vi.mocked(repository.listSubjectGrants).mockResolvedValue([{ grantId: "grant-descendants", siloId: "silo-1", subject: { kind: AuthorizationSubjectKinds.Principal, principalId: "principal-1" }, boundary: { kind: AuthorizationBoundaryKinds.Group, groupId: "group-1" }, boundaryCoverage: AuthorizationBoundaryCoverages.Descendants, capability, resource: { kind: ProductAuthorizationResourceKinds.AgentRevision, id: "revision-1" }, effect: AuthorizationGrantEffects.Allow, priority: 10, validFromEpochMs: 0, expiresAtEpochMs: null, revokedAtEpochMs: null }]);
		await expect(authority.decide(command)).resolves.toMatchObject({ outcome: AuthorizationDecisionOutcomes.Allow, grantIds: ["grant-descendants"] });
	});

	it("records a mutation decision through the transaction-bound recorder", async function _AdmitMutation()
	{
		const repository = _Repository();
		const recorder: ProductAuthorizationDecisionRecorder = { record: vi.fn().mockResolvedValue(undefined) };
		const capability = __ProductAuthorizationCapability(ProductAuthorizationResourceKinds.Skill, ProductAuthorizationActions.Publish);
		if (capability === null)
			throw new Error("skill publish capability is missing");
		vi.mocked(repository.listSubjectGrants).mockResolvedValue([{ grantId: "grant-publish", siloId: "silo-1", subject: { kind: AuthorizationSubjectKinds.Principal, principalId: "principal-1" }, boundary: { kind: AuthorizationBoundaryKinds.Personal, principalId: "principal-1" }, boundaryCoverage: AuthorizationBoundaryCoverages.Exact, capability, resource: { kind: ProductAuthorizationResourceKinds.Skill, id: "skill-allowed" }, effect: AuthorizationGrantEffects.Allow, priority: 10, validFromEpochMs: 0, expiresAtEpochMs: null, revokedAtEpochMs: null }]);
		const authority = new __AuthorizationAuthority(repository, recorder);
		const result = await authority.admit({ siloId: "silo-1", principalId: "principal-1", actorKind: "user", actorId: "principal-1", boundary: { kind: AuthorizationBoundaryKinds.Personal, principalId: "principal-1" }, resource: { kind: ProductAuthorizationResourceKinds.Skill, id: "skill-allowed" }, action: ProductAuthorizationActions.Publish, argumentsDigest: `sha256:${"a".repeat(64)}`, nowEpochMs: 1 });
		expect(result).toMatchObject({ outcome: AuthorizationDecisionOutcomes.Allow, evidence: { decisionDigest: expect.stringMatching(/^sha256:/), effectiveAuthorizationDigest: expect.stringMatching(/^sha256:/) } });
		expect(recorder.record).toHaveBeenCalledWith(expect.any(Object), result);
	});

	it("does not record a denied mutation", async function _DeniedMutation()
	{
		const repository = _Repository();
		vi.mocked(repository.listSubjectGrants).mockResolvedValue([]);
		const recorder: ProductAuthorizationDecisionRecorder = { record: vi.fn().mockResolvedValue(undefined) };
		const authority = new __AuthorizationAuthority(repository, recorder);
		const result = await authority.admit({ siloId: "silo-1", principalId: "principal-1", actorKind: "user", actorId: "principal-1", boundary: { kind: AuthorizationBoundaryKinds.Personal, principalId: "principal-1" }, resource: { kind: ProductAuthorizationResourceKinds.Skill, id: "skill-allowed" }, action: ProductAuthorizationActions.Publish, argumentsDigest: `sha256:${"a".repeat(64)}`, nowEpochMs: 1 });
		expect(result.evidence).toBeNull();
		expect(recorder.record).not.toHaveBeenCalled();
	});

	it("filters a catalogue with one subject, boundary, and grant read", async function _BatchDecision()
	{
		const repository = _Repository();
		const authority = new __AuthorizationAuthority(repository);
		const resources = await authority.listEntitled({ siloId: "silo-1", principalId: "principal-1", boundary: { kind: AuthorizationBoundaryKinds.Personal, principalId: "principal-1" }, action: ProductAuthorizationActions.Discover, resources: [{ kind: ProductAuthorizationResourceKinds.Skill, id: "skill-allowed" }, { kind: ProductAuthorizationResourceKinds.Skill, id: "skill-denied" }], nowEpochMs: 1 });
		expect(resources).toEqual([{ kind: ProductAuthorizationResourceKinds.Skill, id: "skill-allowed" }]);
		expect(repository.resolvePrincipalSubjects).toHaveBeenCalledTimes(1);
		expect(repository.resolveBoundaryContext).toHaveBeenCalledTimes(1);
		expect(repository.listSubjectGrants).toHaveBeenCalledTimes(1);
	});

	it("derives personal and Group boundaries for an actor catalogue without per-resource reads", async function _PrincipalBatchDecision()
	{
		const repository = _Repository();
		vi.mocked(repository.resolvePrincipalSubjects).mockResolvedValue([{ kind: AuthorizationSubjectKinds.Principal, principalId: "principal-1" }, { kind: AuthorizationSubjectKinds.Group, groupId: "group-1" }]);
		const authority = new __AuthorizationAuthority(repository);
		const resources = await authority.listPrincipalEntitled({ siloId: "silo-1", principalId: "principal-1", action: ProductAuthorizationActions.Discover, resources: [{ kind: ProductAuthorizationResourceKinds.Skill, id: "skill-allowed" }, { kind: ProductAuthorizationResourceKinds.Skill, id: "skill-denied" }], nowEpochMs: 1 });
		expect(resources).toEqual([{ kind: ProductAuthorizationResourceKinds.Skill, id: "skill-allowed" }]);
		expect(repository.resolvePrincipalSubjects).toHaveBeenCalledTimes(1);
		expect(repository.listSubjectGrants).toHaveBeenCalledTimes(1);
		expect(repository.resolveBoundaryContext).toHaveBeenCalledTimes(2);
	});

	it("rejects catalogue filtering for a rule that requires durable evidence", async function _RejectsNonReadBatch()
	{
		const repository = _Repository();
		const authority = new __AuthorizationAuthority(repository);
		await expect(authority.listPrincipalEntitled({ siloId: "silo-1", principalId: "principal-1", action: ProductAuthorizationActions.Publish, resources: [{ kind: ProductAuthorizationResourceKinds.Skill, id: "skill-allowed" }], nowEpochMs: 1 })).rejects.toThrow("requires a Read-class rule");
		expect(repository.resolvePrincipalSubjects).not.toHaveBeenCalled();
	});

	it("records no batch evidence when one effect coordinate is denied", async function _RejectsPartialBatch()
	{
		const repository = _Repository();
		const capability = __ProductAuthorizationCapability(ProductAuthorizationResourceKinds.SkillRevision, ProductAuthorizationActions.Use);
		if (capability === null)
			throw new Error("skill revision use capability is missing");
		vi.mocked(repository.listSubjectGrants).mockResolvedValue([{ grantId: "grant-use", siloId: "silo-1", subject: { kind: AuthorizationSubjectKinds.Principal, principalId: "principal-1" }, boundary: { kind: AuthorizationBoundaryKinds.Personal, principalId: "principal-1" }, boundaryCoverage: AuthorizationBoundaryCoverages.Exact, capability, resource: { kind: ProductAuthorizationResourceKinds.SkillRevision, id: "revision-allowed" }, effect: AuthorizationGrantEffects.Allow, priority: 10, validFromEpochMs: 0, expiresAtEpochMs: null, revokedAtEpochMs: null }]);
		const recorder: ProductAuthorizationDecisionRecorder = { record: vi.fn().mockResolvedValue(undefined) };
		const authority = new __AuthorizationAuthority(repository, recorder);
		const shared = { siloId: "silo-1", principalId: "principal-1", actorKind: "user" as const, actorId: "principal-1", action: ProductAuthorizationActions.Use, argumentsDigest: `sha256:${"a".repeat(64)}` as const, nowEpochMs: 1 };
		const results = await authority.admitPrincipalBatch([
			{ ...shared, resource: { kind: ProductAuthorizationResourceKinds.SkillRevision, id: "revision-allowed" } },
			{ ...shared, resource: { kind: ProductAuthorizationResourceKinds.SkillRevision, id: "revision-denied" } },
		]);
		expect(results).toEqual([]);
		expect(recorder.record).not.toHaveBeenCalled();
	});

	it("replaces product-managed grants only after durable root administration admission", async function _ReplaceManagedGrants()
	{
		const repository = _Repository();
		const capability = __ProductAuthorizationCapability(ProductAuthorizationResourceKinds.Organization, ProductAuthorizationActions.Administer);
		if (capability === null)
			throw new Error("organization administration capability is missing");
		vi.mocked(repository.listSubjectGrants).mockResolvedValue([{ grantId: "grant-admin", siloId: "silo-1", subject: { kind: AuthorizationSubjectKinds.Principal, principalId: "principal-1" }, boundary: { kind: AuthorizationBoundaryKinds.Personal, principalId: "principal-1" }, boundaryCoverage: AuthorizationBoundaryCoverages.Exact, capability, resource: { kind: ProductAuthorizationResourceKinds.Organization, id: "silo-1" }, effect: AuthorizationGrantEffects.Allow, priority: 100, validFromEpochMs: 0, expiresAtEpochMs: null, revokedAtEpochMs: null }]);
		const recorder: ProductAuthorizationDecisionRecorder = { record: vi.fn().mockResolvedValue(undefined) };
		const managedGrants: ManagedAuthorizationGrantRepository = { listManagedResourceGrants: vi.fn().mockResolvedValue([]), reconcileManagedResourceGrants: vi.fn().mockResolvedValue(2) };
		const authority = new __AuthorizationAuthority(repository, recorder, managedGrants);
		const result = await authority.replaceManagedGrants({ siloId: "silo-1", principalId: "principal-1", actorKind: "user", actorId: "principal-1", managerId: "test-editor", resource: { kind: ProductAuthorizationResourceKinds.McpServer, id: "server-1" }, grants: [], now: new Date(1), nowEpochMs: 1 });
		expect(result).toMatchObject({ outcome: AuthorizationDecisionOutcomes.Allow, changedCount: 2, evidence: { decisionDigest: expect.stringMatching(/^sha256:/) } });
		expect(managedGrants.reconcileManagedResourceGrants).toHaveBeenCalledWith(expect.objectContaining({ managerId: "test-editor", resource: { kind: ProductAuthorizationResourceKinds.McpServer, id: "server-1" } }));
	});
});
