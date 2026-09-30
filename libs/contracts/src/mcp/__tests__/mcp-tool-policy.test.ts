import { describe, expect, it } from "vitest";

import { McpToolPolicyChangeOutcomes, McpToolPolicyModes, ___McpToolPolicyChangeCommandSchema, ___McpToolPolicyChangeResultSchema, ___McpToolPolicyProjectionSchema } from "../../index";

const _Target = { installId: "install-1", toolRevisionId: "tool-revision-1" };
const _Uuid = "11111111-1111-4111-8111-111111111111";
const _UpdatedAt = "2026-09-29T10:00:00+02:00";

/** Builds one valid command for each policy mode. */
function _Command(mode: McpToolPolicyModes)
{
	return { target: _Target, mode, idempotencyKey: _Uuid, expectedRevision: null };
}

/** Builds one saved projection with the required revision evidence. */
function _Projection(mode: McpToolPolicyModes)
{
	return { target: _Target, mode, revision: 1, updatedAt: _UpdatedAt };
}

describe("MCP tool policy contract", function _McpToolPolicyContract()
{
	it.each(Object.values(McpToolPolicyModes))("accepts the %s command without redundant authority", function _AcceptsMode(mode)
	{
		expect(___McpToolPolicyChangeCommandSchema.safeParse(_Command(mode)).success).toBe(true);
	});

	it("accepts the unique absent Ask projection", function _AcceptsAbsentAsk()
	{
		expect(___McpToolPolicyProjectionSchema.safeParse({ target: _Target, mode: McpToolPolicyModes.Ask, revision: null, updatedAt: null }).success).toBe(true);
	});

	it.each(Object.values(McpToolPolicyModes))("accepts a present %s projection", function _AcceptsPresentMode(mode)
	{
		expect(___McpToolPolicyProjectionSchema.safeParse(_Projection(mode)).success).toBe(true);
	});

	it("rejects missing, unknown, authority and credential fields", function _RejectsWidenedShapes()
	{
		expect(___McpToolPolicyChangeCommandSchema.safeParse({ target: _Target, idempotencyKey: _Uuid, expectedRevision: null }).success).toBe(false);
		expect(___McpToolPolicyChangeCommandSchema.safeParse({ ..._Command(McpToolPolicyModes.Ask), serverId: "server-1" }).success).toBe(false);
		expect(___McpToolPolicyChangeCommandSchema.safeParse({ ..._Command(McpToolPolicyModes.Ask), principalId: "principal-1" }).success).toBe(false);
		expect(___McpToolPolicyChangeCommandSchema.safeParse({ ..._Command(McpToolPolicyModes.Ask), credential: "secret" }).success).toBe(false);
		expect(___McpToolPolicyChangeCommandSchema.safeParse({ ..._Command(McpToolPolicyModes.Ask), mode: "unknown" }).success).toBe(false);
		expect(___McpToolPolicyChangeCommandSchema.safeParse({ ..._Command(McpToolPolicyModes.Ask), target: { ..._Target, siloId: "silo-1" } }).success).toBe(false);
		expect(___McpToolPolicyChangeCommandSchema.safeParse({ ..._Command(McpToolPolicyModes.Ask), target: { ..._Target, ownerPrincipalId: "principal-1" } }).success).toBe(false);
		expect(___McpToolPolicyChangeCommandSchema.safeParse({ ..._Command(McpToolPolicyModes.Ask), target: { ..._Target, credential: "secret" } }).success).toBe(false);
		expect(___McpToolPolicyChangeCommandSchema.safeParse({ ..._Command(McpToolPolicyModes.Ask), target: { installId: " ", toolRevisionId: "tool-revision-1" } }).success).toBe(false);
		expect(___McpToolPolicyChangeCommandSchema.safeParse({ ..._Command(McpToolPolicyModes.Ask), target: { installId: " install-1", toolRevisionId: "tool-revision-1" } }).success).toBe(false);
	});

	it("rejects malformed identifiers and revisions", function _RejectsMalformedCommand()
	{
		for (const expectedRevision of [0, -1, 1.5, 2_147_483_648, NaN])
			expect(___McpToolPolicyChangeCommandSchema.safeParse({ ..._Command(McpToolPolicyModes.Ask), expectedRevision }).success).toBe(false);
		expect(___McpToolPolicyChangeCommandSchema.safeParse({ ..._Command(McpToolPolicyModes.Ask), expectedRevision: 2_147_483_647 }).success).toBe(true);
		expect(___McpToolPolicyChangeCommandSchema.safeParse({ ..._Command(McpToolPolicyModes.Ask), idempotencyKey: "not-a-uuid" }).success).toBe(false);
	});

	it("rejects inconsistent absent-state and timestamp shapes", function _RejectsInconsistentProjection()
	{
		for (const value of [
			{ target: _Target, mode: McpToolPolicyModes.Auto, revision: null, updatedAt: null },
			{ target: _Target, mode: McpToolPolicyModes.Ask, revision: null, updatedAt: _UpdatedAt },
			{ target: _Target, mode: McpToolPolicyModes.Block, revision: null, updatedAt: null },
			{ target: _Target, mode: McpToolPolicyModes.Auto, revision: 1, updatedAt: null },
			{ target: _Target, mode: McpToolPolicyModes.Auto, revision: 1, updatedAt: "not-a-timestamp" },
		])
			expect(___McpToolPolicyProjectionSchema.safeParse(value).success).toBe(false);
		expect(___McpToolPolicyProjectionSchema.safeParse({ ..._Projection(McpToolPolicyModes.Auto), revision: 2_147_483_648 }).success).toBe(false);
		expect(___McpToolPolicyProjectionSchema.safeParse({ ..._Projection(McpToolPolicyModes.Auto), revision: 2_147_483_647 }).success).toBe(true);
	});

	it("constrains projections by change outcome", function _ConstrainsResult()
	{
		expect(___McpToolPolicyChangeResultSchema.safeParse({ outcome: McpToolPolicyChangeOutcomes.Admitted, projection: _Projection(McpToolPolicyModes.Auto) }).success).toBe(true);
		expect(___McpToolPolicyChangeResultSchema.safeParse({ outcome: McpToolPolicyChangeOutcomes.Replayed, projection: _Projection(McpToolPolicyModes.Ask) }).success).toBe(true);
		expect(___McpToolPolicyChangeResultSchema.safeParse({ outcome: McpToolPolicyChangeOutcomes.Conflict, projection: null }).success).toBe(true);
		expect(___McpToolPolicyChangeResultSchema.safeParse({ outcome: McpToolPolicyChangeOutcomes.Denied, projection: null }).success).toBe(true);
		expect(___McpToolPolicyChangeResultSchema.safeParse({ outcome: McpToolPolicyChangeOutcomes.Conflict, projection: _Projection(McpToolPolicyModes.Block) }).success).toBe(false);
		expect(___McpToolPolicyChangeResultSchema.safeParse({ outcome: McpToolPolicyChangeOutcomes.Admitted, projection: { target: _Target, mode: McpToolPolicyModes.Ask, revision: null, updatedAt: null } }).success).toBe(false);
		expect(___McpToolPolicyChangeResultSchema.safeParse({ outcome: McpToolPolicyChangeOutcomes.Replayed, projection: { target: _Target, mode: McpToolPolicyModes.Ask, revision: null, updatedAt: null } }).success).toBe(false);
		expect(___McpToolPolicyChangeResultSchema.safeParse({ outcome: "unknown", projection: null }).success).toBe(false);
	});
});
