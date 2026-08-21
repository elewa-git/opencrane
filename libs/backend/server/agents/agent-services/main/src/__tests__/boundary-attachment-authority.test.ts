import { RevisionBoundaryCoverages, RevisionBoundaryKinds, type RevisionBoundaryAttachment } from "@opencrane/models/agents";
import { describe, expect, it } from "vitest";

import { __IntersectBoundaryAttachments, __ResolveEffectiveBoundaryAttachments, __ValidateBoundaryAttachAuthority } from "../boundary-attachment-authority";
import type { BoundaryGrantResolutionCommand, BoundaryGrantResolver, EffectiveBoundaryGrant } from "../boundary-attachment-authority.types";

/** Returns a fixed allow-only boundary grant set for any principal. */
class _FakeResolver implements BoundaryGrantResolver
{
	/** Creates the fake with its fixed grants. */
	constructor(private readonly grants: readonly EffectiveBoundaryGrant[]) {}

	/** Returns the configured grant set. */
	async resolveEffectiveBoundaryGrants(_command: BoundaryGrantResolutionCommand): Promise<readonly EffectiveBoundaryGrant[]> { return this.grants; }
}

/** Allows one exact stored group boundary. */
const _GROUP_ONLY: EffectiveBoundaryGrant[] = [{ boundaryKind: RevisionBoundaryKinds.Group, boundaryId: "group-1", boundaryCoverage: RevisionBoundaryCoverages.Exact }];

/** Declares the same exact group boundary on a revision. */
const _GROUP_ATTACHMENT: RevisionBoundaryAttachment[] = [{ boundaryKind: RevisionBoundaryKinds.Group, boundaryId: "group-1", boundaryCoverage: RevisionBoundaryCoverages.Exact }];

/** Mixes exact, descendant, and personal boundaries to prove matching never widens. */
const _BOUNDARIES: RevisionBoundaryAttachment[] = [
	{ boundaryKind: RevisionBoundaryKinds.Group, boundaryId: "group-1", boundaryCoverage: RevisionBoundaryCoverages.Exact },
	{ boundaryKind: RevisionBoundaryKinds.Group, boundaryId: "group-2", boundaryCoverage: RevisionBoundaryCoverages.Exact },
	{ boundaryKind: RevisionBoundaryKinds.Group, boundaryId: "group-1", boundaryCoverage: RevisionBoundaryCoverages.Descendants },
	{ boundaryKind: RevisionBoundaryKinds.Personal, boundaryId: "principal-9", boundaryCoverage: RevisionBoundaryCoverages.Exact },
];

describe("boundary-attachment intersection", function _IntersectSuite()
{
	it("keeps only attachments backed by the same boundary and coverage", function _KeepsBacked()
	{
		const { authorized, rejected } = __IntersectBoundaryAttachments(_BOUNDARIES, _GROUP_ONLY);
		expect(authorized).toEqual(_GROUP_ONLY);
		expect(rejected).toHaveLength(3);
	});

	it("never widens an empty effective grant set", function _NeverWidens()
	{
		expect(__IntersectBoundaryAttachments(_BOUNDARIES, []).authorized).toHaveLength(0);
	});
});

describe("runtime effective boundary resolution", function _ResolveSuite()
{
	it("does not treat descendant coverage as equivalent to exact coverage", async function _CoverageIsolation()
	{
		const { authorized, rejected } = await __ResolveEffectiveBoundaryAttachments(new _FakeResolver(_GROUP_ONLY), "silo-1", ["agent-service:svc-1"], _BOUNDARIES, 1_000);
		expect(authorized).toEqual(_GROUP_ONLY);
		expect(rejected).toHaveLength(3);
	});
});

describe("boundary attach authority", function _AttachSuite()
{
	it("authorizes only when every attachment has a matching effective grant", async function _CallerAdministers()
	{
		expect(await __ValidateBoundaryAttachAuthority(new _FakeResolver(_GROUP_ONLY), "silo-1", ["admin-1"], _GROUP_ATTACHMENT, 1_000)).toEqual({ outcome: "authorized" });
	});

	it("returns every attachment that lacks backing authority", async function _CallerLacks()
	{
		const result = await __ValidateBoundaryAttachAuthority(new _FakeResolver(_GROUP_ONLY), "silo-1", ["admin-1"], _BOUNDARIES, 1_000);
		expect(result.outcome).toBe("unauthorized");
		if (result.outcome !== "unauthorized") throw new Error("expected unauthorized");
		expect(result.unauthorized).toHaveLength(3);
	});

	it("does not consult grants for an empty attachment list", async function _Empty()
	{
		let consulted = false;
		const resolver: BoundaryGrantResolver = { async resolveEffectiveBoundaryGrants() { consulted = true; return []; } };
		expect(await __ValidateBoundaryAttachAuthority(resolver, "silo-1", ["admin-1"], [], 1_000)).toEqual({ outcome: "authorized" });
		expect(consulted).toBe(false);
	});
});
