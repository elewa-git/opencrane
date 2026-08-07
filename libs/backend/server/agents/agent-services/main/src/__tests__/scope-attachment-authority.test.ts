import type { RevisionScopeAttachment } from "@opencrane/models/agents";
import { describe, expect, it } from "vitest";

import { __IntersectScopeAttachments, __ResolveEffectiveScopeAttachments, __ValidateAttachAuthority } from "../scope-attachment-authority.js";
import type { EffectiveScopeGrant, ScopeGrantResolver } from "../scope-attachment-authority.types.js";

/** Fake resolver returning a fixed allow-only effective-grant set for any principal. */
class _FakeResolver implements ScopeGrantResolver
{
	constructor(private readonly grants: readonly EffectiveScopeGrant[]) {}
	async resolveEffectiveScopeGrants(): Promise<readonly EffectiveScopeGrant[]> { return this.grants; }
}

/** The effective grants a project-scoped agent actually holds: one project dataset only. */
const _PROJECT_ONLY: EffectiveScopeGrant[] = [{ scope: "project", subjectType: "group", subjectId: "proj-1" }];

/** Attachments spanning every scope tier, only one of which is backed by an effective grant. */
const _ALL_SCOPES: RevisionScopeAttachment[] = [
	{ scope: "project", subjectType: "group", subjectId: "proj-1" }, // backed
	{ scope: "project", subjectType: "group", subjectId: "proj-2" }, // peer project — not backed
	{ scope: "personal", subjectType: "user", subjectId: "user-9" },
	{ scope: "department", subjectType: "group", subjectId: "dept-1" },
	{ scope: "org", subjectType: "tenant", subjectId: "default" },
];

describe("scope-attachment intersection", function _IntersectSuite()
{
	it("keeps only attachments backed by an effective allow grant", function _KeepsBacked()
	{
		const { authorized, rejected } = __IntersectScopeAttachments(_ALL_SCOPES, _PROJECT_ONLY);
		expect(authorized).toEqual([{ scope: "project", subjectType: "group", subjectId: "proj-1" }]);
		expect(rejected).toHaveLength(4);
	});

	it("never widens: an empty effective-grant set authorises nothing", function _NeverWidens()
	{
		const { authorized } = __IntersectScopeAttachments(_ALL_SCOPES, []);
		expect(authorized).toHaveLength(0);
	});
});

describe("runtime effective-access resolution (scope isolation)", function _ResolveSuite()
{
	it("a project-scoped agent cannot read/write peer-project, personal, department, or org scopes", async function _Isolation()
	{
		const resolver = new _FakeResolver(_PROJECT_ONLY);
		const { authorized, rejected } = await __ResolveEffectiveScopeAttachments(resolver, ["agent-service:svc-1"], _ALL_SCOPES);
		expect(authorized.map(a => `${a.scope}:${a.subjectId}`)).toEqual(["project:proj-1"]);
		expect(rejected.map(a => `${a.scope}:${a.subjectId}`)).toEqual(["project:proj-2", "personal:user-9", "department:dept-1", "org:default"]);
	});

	it("grants exactly what an explicit attachment adds when the agent is also granted it", async function _ExplicitAttach()
	{
		const resolver = new _FakeResolver([...(_PROJECT_ONLY), { scope: "team", subjectType: "group", subjectId: "team-7" }]);
		const attachments: RevisionScopeAttachment[] = [{ scope: "team", subjectType: "group", subjectId: "team-7" }];
		const { authorized } = await __ResolveEffectiveScopeAttachments(resolver, ["agent-service:svc-1"], attachments);
		expect(authorized).toEqual(attachments);
	});
});

describe("attach-time authority", function _AttachSuite()
{
	it("authorises only when the caller administers every attached scope", async function _CallerAdministers()
	{
		const resolver = new _FakeResolver(_PROJECT_ONLY);
		expect(await __ValidateAttachAuthority(resolver, ["admin-1"], [{ scope: "project", subjectType: "group", subjectId: "proj-1" }])).toEqual({ outcome: "authorized" });
	});

	it("rejects an attachment the caller does not administer, naming the offending triples", async function _CallerLacks()
	{
		const resolver = new _FakeResolver(_PROJECT_ONLY);
		const result = await __ValidateAttachAuthority(resolver, ["admin-1"], _ALL_SCOPES);
		expect(result.outcome).toBe("unauthorized");
		if (result.outcome !== "unauthorized") throw new Error("expected unauthorized");
		expect(result.unauthorized).toHaveLength(4);
	});

	it("authorises an empty attachment list without consulting the resolver", async function _Empty()
	{
		let consulted = false;
		const resolver: ScopeGrantResolver = { async resolveEffectiveScopeGrants() { consulted = true; return []; } };
		expect(await __ValidateAttachAuthority(resolver, ["admin-1"], [])).toEqual({ outcome: "authorized" });
		expect(consulted).toBe(false);
	});
});
