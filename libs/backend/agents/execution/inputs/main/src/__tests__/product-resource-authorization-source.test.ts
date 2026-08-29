import { describe, expect, it, vi } from "vitest";

import { ProductAuthorizationActions, ProductAuthorizationResourceKinds } from "@opencrane/models/authorization";

import { TransactionBoundProductResourceAuthorizationSource } from "../product-resource-authorization-source";

/** Complete resource selection assembled from current run inputs. */
const _RESOURCES = [
	{ kind: ProductAuthorizationResourceKinds.ModelDefinition, id: "model-1" },
	{ kind: ProductAuthorizationResourceKinds.McpToolRevision, id: "tool-1" },
	{ kind: ProductAuthorizationResourceKinds.SkillRevision, id: "skill-1" },
	{ kind: ProductAuthorizationResourceKinds.ArtifactRevision, id: "artifact-1" },
	{ kind: ProductAuthorizationResourceKinds.Persona, id: "persona-1" },
	{ kind: ProductAuthorizationResourceKinds.Dataset, id: "dataset-1" },
	{ kind: ProductAuthorizationResourceKinds.MemoryScope, id: "dataset-1" },
] as const;

/** Invokes the source with one current central entitlement result. */
function _Load(entitled: readonly { readonly kind: ProductAuthorizationResourceKinds; readonly id: string }[])
{
	const listPrincipalEntitled = vi.fn().mockResolvedValue(entitled);
	const source = new TransactionBoundProductResourceAuthorizationSource();
	const result = source.load(
		{ siloId: "silo-1" } as never,
		{ kind: "user", principalId: "principal-1", executionSubjectId: "user-1" } as never,
		{ personaRevisionId: "persona-revision-1", personaId: "persona-1" },
		{ memoryQueryPolicy: {}, datasetId: "dataset-1" },
		{ modelDefinitionId: "model-1", modelRoute: {}, mcpTools: [{ toolRevisionId: "tool-1" } as never], skillRevisionIds: ["skill-1"], artifactRevisionIds: ["artifact-1"] },
		{ prisma: {} as never, authorization: { listPrincipalEntitled } as never, admittedAt: "2026-08-29T00:00:00.000Z", admittedAtEpochMs: 1_788_000_000_000 },
	);
	return { result, listPrincipalEntitled };
}

describe("TransactionBoundProductResourceAuthorizationSource", function _Suite()
{
	it("batch-checks every selected resource through current Use grants", async function _AllowsCompleteSet()
	{
		const { result, listPrincipalEntitled } = _Load(_RESOURCES);

		await expect(result).resolves.toEqual({ outcome: "loaded", value: null });
		expect(listPrincipalEntitled).toHaveBeenCalledWith({ siloId: "silo-1", principalId: "principal-1", action: ProductAuthorizationActions.Use, resources: _RESOURCES, nowEpochMs: 1_788_000_000_000 });
	});

	it("fails closed when one exact selected resource is not currently entitled", async function _DeniesIncompleteSet()
	{
		const { result } = _Load(_RESOURCES.slice(0, -1));

		await expect(result).resolves.toEqual({ outcome: "denied", reason: "product_authorization_unavailable" });
	});
});
