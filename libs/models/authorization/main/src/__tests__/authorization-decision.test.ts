import { describe, expect, it } from "vitest";
import { __DecideAuthorization } from "../authorization-decision.js";
import type { AuthorizationScope } from "../authorization-scope.types.js";
import type { CapabilityReference } from "../capability.types.js";
import type { AuthorizationGrant, AuthorizationRequest } from "../grant.types.js";
import { __AuthorizationScopesEqual } from "../scope-matching.js";

/** Capability used by the grant decision table. */
const CAPABILITY: CapabilityReference = {
	catalog: { catalogId: "core", revision: 4, digest: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" },
	capabilityId: "artifact.read",
};

/** Project target shared by most decision cases. */
const PROJECT_SCOPE: AuthorizationScope = {
	kind: "project",
	organizationId: "org-a",
	projectId: "project-shared",
};

/** Exact artifact resource targeted by most decision cases. */
const RESOURCE = { kind: "artifact", id: "artifact-7" } as const;

/** Request shared by most decision cases. */
const REQUEST: AuthorizationRequest = {
	siloId: "silo-a",
	subjectId: "user-a",
	scope: PROJECT_SCOPE,
	capability: CAPABILITY,
	resource: RESOURCE,
	nowEpochMs: 2000,
};

/**
 * Creates a grant with explicit overrides for one decision case.
 * @param overrides - Fields that replace the valid baseline grant.
 * @returns Authorization grant for the requested capability.
 */
function _grant(overrides: Partial<AuthorizationGrant> = {}): AuthorizationGrant
{
	return {
		grantId: "grant-a",
		siloId: "silo-a",
		subjectId: "user-a",
		scope: PROJECT_SCOPE,
		capability: CAPABILITY,
		resource: RESOURCE,
		effect: "allow",
		priority: 10,
		validFromEpochMs: 1000,
		expiresAtEpochMs: 3000,
		revokedAtEpochMs: null,
		...overrides,
	};
}

describe("authorization grant decision table", function ()
{
	it("allows a matching project grant", function ()
	{
		expect(__DecideAuthorization(REQUEST, [_grant()])).toEqual({
			outcome: "allow",
			reason: "winning_allow",
			grantIds: ["grant-a"],
			winningPriority: 10,
		});
	});

	it("allows organization scope to cover a project in the same organization", function ()
	{
		const decision = __DecideAuthorization(REQUEST, [_grant({
			scope: { kind: "organization", organizationId: "org-a" },
		})]);

		expect(decision.outcome).toBe("allow");
	});

	it("keeps project independent from department scope", function ()
	{
		const decision = __DecideAuthorization(REQUEST, [_grant({
			scope: { kind: "department", organizationId: "org-a", departmentId: "project-shared" },
		})]);

		expect(decision).toEqual({ outcome: "deny", reason: "no_matching_grant", grantIds: [] });
	});

	it("keeps project independent from team scope", function ()
	{
		const decision = __DecideAuthorization(REQUEST, [_grant({
			scope: { kind: "team", organizationId: "org-a", teamId: "project-shared" },
		})]);

		expect(decision.reason).toBe("no_matching_grant");
	});

	it("keeps personal and direct-user scopes distinct", function ()
	{
		const directRequest: AuthorizationRequest = {
			...REQUEST,
			scope: { kind: "direct-user", organizationId: "org-a", userId: "user-b" },
		};
		const decision = __DecideAuthorization(directRequest, [_grant({
			scope: { kind: "personal", organizationId: "org-a", userId: "user-b" },
		})]);

		expect(decision.reason).toBe("no_matching_grant");
	});

	it("matches a direct-user grant only to the addressed user", function ()
	{
		const directRequest: AuthorizationRequest = {
			...REQUEST,
			scope: { kind: "direct-user", organizationId: "org-a", userId: "user-b" },
		};
		const decision = __DecideAuthorization(directRequest, [_grant({
			scope: { kind: "direct-user", organizationId: "org-a", userId: "user-b" },
		})]);

		expect(decision.outcome).toBe("allow");
	});

	it("rejects grants from another organization, silo, or subject", function ()
	{
		const grants = [
			_grant({ grantId: "org", scope: { kind: "organization", organizationId: "org-b" } }),
			_grant({ grantId: "silo", siloId: "silo-b" }),
			_grant({ grantId: "subject", subjectId: "user-b" }),
		];

		expect(__DecideAuthorization(REQUEST, grants).reason).toBe("no_matching_grant");
	});

	it("requires an exact immutable capability catalog reference", function ()
	{
		const grants = [
			_grant({ grantId: "catalog", capability: { ...CAPABILITY, catalog: { ...CAPABILITY.catalog, catalogId: "other" } } }),
			_grant({ grantId: "revision", capability: { ...CAPABILITY, catalog: { ...CAPABILITY.catalog, revision: 3 } } }),
			_grant({ grantId: "digest", capability: { ...CAPABILITY, catalog: { ...CAPABILITY.catalog, digest: "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" } } }),
			_grant({ grantId: "capability", capability: { ...CAPABILITY, capabilityId: "artifact.write" } }),
		];

		expect(__DecideAuthorization(REQUEST, grants).reason).toBe("no_matching_grant");
	});

	it("requires the exact resource kind and identifier", function ()
	{
		const grants = [
			_grant({ grantId: "kind", resource: { kind: "thread", id: "artifact-7" } }),
			_grant({ grantId: "id", resource: { kind: "artifact", id: "artifact-8" } }),
		];

		expect(__DecideAuthorization(REQUEST, grants).reason).toBe("no_matching_grant");
		expect(__DecideAuthorization(REQUEST, [_grant({ resource: RESOURCE })]).outcome).toBe("allow");
	});

	it("fails closed for invalid request and grant resource locators", function ()
	{
		const invalidLocators = [
			{ kind: "", id: "artifact-7" },
			{ kind: " artifact", id: "artifact-7" },
			{ kind: "artifact", id: "" },
			{ kind: "artifact", id: " artifact-7" },
			{ kind: "artifact", id: "*" },
		];

		for (const invalidLocator of invalidLocators)
		{
			const invalidRequest = { ...REQUEST, resource: invalidLocator };
			expect(__DecideAuthorization(invalidRequest, [_grant({ resource: invalidLocator })]).reason).toBe("no_matching_grant");
			expect(__DecideAuthorization(REQUEST, [_grant({ resource: invalidLocator })]).reason).toBe("no_matching_grant");
		}
	});

	it("rejects resource locators with extra fields", function ()
	{
		const augmentedResource = { ...RESOURCE, wildcard: true };

		expect(__DecideAuthorization(REQUEST, [_grant({ resource: augmentedResource })]).reason).toBe("no_matching_grant");
	});

	it("lets a higher-priority allow replace a lower-priority deny", function ()
	{
		const decision = __DecideAuthorization(REQUEST, [
			_grant({ grantId: "low-deny", effect: "deny", priority: 10 }),
			_grant({ grantId: "high-allow", effect: "allow", priority: 20 }),
		]);

		expect(decision).toEqual({
			outcome: "allow",
			reason: "winning_allow",
			grantIds: ["high-allow"],
			winningPriority: 20,
		});
	});

	it("lets a higher-priority deny replace a lower-priority allow", function ()
	{
		const decision = __DecideAuthorization(REQUEST, [
			_grant({ grantId: "low-allow", effect: "allow", priority: 10 }),
			_grant({ grantId: "high-deny", effect: "deny", priority: 20 }),
		]);

		expect(decision.outcome).toBe("deny");
		expect(decision.grantIds).toEqual(["high-deny"]);
	});

	it("makes deny win when allow and deny share the highest priority", function ()
	{
		const decision = __DecideAuthorization(REQUEST, [
			_grant({ grantId: "equal-allow", effect: "allow", priority: 20 }),
			_grant({ grantId: "equal-deny", effect: "deny", priority: 20 }),
			_grant({ grantId: "low-allow", effect: "allow", priority: 10 }),
		]);

		expect(decision).toEqual({
			outcome: "deny",
			reason: "winning_deny",
			grantIds: ["equal-allow", "equal-deny"],
			winningPriority: 20,
		});
	});

	it("fails closed when a matching priority cannot be ordered safely", function ()
	{
		const decision = __DecideAuthorization(REQUEST, [
			_grant({ grantId: "valid", priority: 10 }),
			_grant({ grantId: "invalid", priority: Number.NaN }),
		]);

		expect(decision).toEqual({
			outcome: "deny",
			reason: "invalid_grant_priority",
			grantIds: ["invalid"],
		});
	});

	it("fails closed for negative and non-integer matching priorities", function ()
	{
		for (const priority of [-1, 1.5])
		{
			expect(__DecideAuthorization(REQUEST, [_grant({ grantId: `invalid-${priority}`, priority })])).toEqual({
				outcome: "deny",
				reason: "invalid_grant_priority",
				grantIds: [`invalid-${priority}`],
			});
		}
	});

	it("never authorizes future, expired, or revoked grants", function ()
	{
		const inactiveGrants = [
			_grant({ grantId: "future", validFromEpochMs: REQUEST.nowEpochMs + 1, expiresAtEpochMs: REQUEST.nowEpochMs + 100 }),
			_grant({ grantId: "expired", expiresAtEpochMs: REQUEST.nowEpochMs }),
			_grant({ grantId: "revoked", revokedAtEpochMs: REQUEST.nowEpochMs - 1 }),
		];

		expect(__DecideAuthorization(REQUEST, inactiveGrants)).toEqual({ outcome: "deny", reason: "no_matching_grant", grantIds: [] });
	});

	it("fails closed for malformed request time and matching grant validity", function ()
	{
		expect(__DecideAuthorization({ ...REQUEST, nowEpochMs: Number.NaN }, [_grant()])).toEqual({ outcome: "deny", reason: "invalid_request_time", grantIds: [] });

		const invalidValidityGrants = [
			_grant({ grantId: "invalid-start", validFromEpochMs: -1 }),
			_grant({ grantId: "invalid-expiry", expiresAtEpochMs: 1000 }),
			_grant({ grantId: "invalid-revocation", revokedAtEpochMs: 999 }),
		];
		expect(__DecideAuthorization(REQUEST, invalidValidityGrants)).toEqual({
			outcome: "deny",
			reason: "invalid_grant_validity",
			grantIds: ["invalid-start", "invalid-expiry", "invalid-revocation"],
		});
	});

	it("treats organization coverage as directional rather than scope equality", function ()
	{
		const organizationScope: AuthorizationScope = { kind: "organization", organizationId: "org-a" };

		expect(__AuthorizationScopesEqual(organizationScope, PROJECT_SCOPE)).toBe(false);
		expect(__AuthorizationScopesEqual(PROJECT_SCOPE, PROJECT_SCOPE)).toBe(true);
	});
});
