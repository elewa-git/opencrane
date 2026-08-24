import { describe, expect, it } from "vitest";

import { AuthorizationBoundaryCoverages, AuthorizationBoundaryKinds, AuthorizationSubjectKinds } from "../authorization-boundary.types";
import { __DecideAuthorization } from "../authorization-decision";
import { __AuthorizationBoundariesEqual, __AuthorizationBoundaryCovers } from "../boundary-matching";
import { AuthorizationDecisionOutcomes, AuthorizationGrantEffects, type AuthorizationGrant, type AuthorizationRequest } from "../grant.types";

/** Immutable capability used by the decision fixtures. */
const CAPABILITY = { catalog: { catalogId: "core", revision: 1, digest: `sha256:${"a".repeat(64)}` as const }, capabilityId: "resource:read" };

/** Builds one valid group grant and applies focused overrides. */
function _grant(overrides: Partial<AuthorizationGrant> = {}): AuthorizationGrant
{
	return {
		grantId: "grant-1",
		siloId: "silo-1",
		subject: { kind: AuthorizationSubjectKinds.Principal, principalId: "principal-1" },
		boundary: { kind: AuthorizationBoundaryKinds.Group, groupId: "team-1" },
		boundaryCoverage: AuthorizationBoundaryCoverages.Exact,
		capability: CAPABILITY,
		resource: { kind: "dataset", id: "dataset-1" },
		effect: AuthorizationGrantEffects.Allow,
		priority: 10,
		validFromEpochMs: 100,
		expiresAtEpochMs: null,
		revokedAtEpochMs: null,
		...overrides,
	};
}

/** Builds the corresponding authorization request. */
function _request(overrides: Partial<AuthorizationRequest> = {}): AuthorizationRequest
{
	return {
		siloId: "silo-1",
		subjects: [{ kind: AuthorizationSubjectKinds.Principal, principalId: "principal-1" }],
		boundary: { kind: AuthorizationBoundaryKinds.Group, groupId: "team-1" },
		capability: CAPABILITY,
		resource: { kind: "dataset", id: "dataset-1" },
		nowEpochMs: 200,
		...overrides,
	};
}

describe("authorization decision", function _suite()
{
	it("allows an exact group boundary for the resolved principal", function _exact()
	{
		expect(__DecideAuthorization(_request(), [_grant()], { requestedGroupAncestorIds: ["department-1"] })).toEqual({
			outcome: AuthorizationDecisionOutcomes.Allow,
			reason: "winning_allow",
			grantIds: ["grant-1"],
			winningPriority: 10,
		});
	});

	it("uses persisted ancestry for descendant coverage", function _descendants()
	{
		const grant = _grant({ boundary: { kind: AuthorizationBoundaryKinds.Group, groupId: "department-1" }, boundaryCoverage: AuthorizationBoundaryCoverages.Descendants });
		expect(__DecideAuthorization(_request(), [grant], { requestedGroupAncestorIds: ["department-1", "org-root"] }).outcome).toBe(AuthorizationDecisionOutcomes.Allow);
		expect(__DecideAuthorization(_request(), [grant], { requestedGroupAncestorIds: [] }).outcome).toBe(AuthorizationDecisionOutcomes.Deny);
	});

	it("accepts a direct group subject but never an unrelated group", function _directMembership()
	{
		const grant = _grant({ subject: { kind: AuthorizationSubjectKinds.Group, groupId: "team-1" } });
		const memberRequest = _request({ subjects: [
			{ kind: AuthorizationSubjectKinds.Principal, principalId: "principal-1" },
			{ kind: AuthorizationSubjectKinds.Group, groupId: "team-1" },
		] });
		expect(__DecideAuthorization(memberRequest, [grant], { requestedGroupAncestorIds: [] }).outcome).toBe(AuthorizationDecisionOutcomes.Allow);
		expect(__DecideAuthorization(_request(), [grant], { requestedGroupAncestorIds: [] }).outcome).toBe(AuthorizationDecisionOutcomes.Deny);
	});

	it("denies descendant coverage for a personal boundary", function _personalExactOnly()
	{
		const personal = { kind: AuthorizationBoundaryKinds.Personal, principalId: "principal-1" } as const;
		const grant = _grant({ boundary: personal, boundaryCoverage: AuthorizationBoundaryCoverages.Descendants });
		expect(__DecideAuthorization(_request({ boundary: personal }), [grant], { requestedGroupAncestorIds: [] }).outcome).toBe(AuthorizationDecisionOutcomes.Deny);
	});

	it("lets a deny win at the highest matching priority", function _denyWins()
	{
		const allow = _grant({ grantId: "allow" });
		const deny = _grant({ grantId: "deny", effect: AuthorizationGrantEffects.Deny });
		expect(__DecideAuthorization(_request(), [allow, deny], { requestedGroupAncestorIds: [] })).toMatchObject({ outcome: AuthorizationDecisionOutcomes.Deny, reason: "winning_deny", grantIds: ["allow", "deny"] });
	});

	it("compares group and personal boundaries without implied hierarchy", function _equality()
	{
		const group = { kind: AuthorizationBoundaryKinds.Group, groupId: "team-1" } as const;
		const personal = { kind: AuthorizationBoundaryKinds.Personal, principalId: "principal-1" } as const;
		expect(__AuthorizationBoundariesEqual(group, group)).toBe(true);
		expect(__AuthorizationBoundariesEqual(group, personal)).toBe(false);
		expect(__AuthorizationBoundaryCovers(group, AuthorizationBoundaryCoverages.Descendants, { kind: AuthorizationBoundaryKinds.Group, groupId: "child" }, { requestedGroupAncestorIds: ["team-1"] })).toBe(true);
	});
});
