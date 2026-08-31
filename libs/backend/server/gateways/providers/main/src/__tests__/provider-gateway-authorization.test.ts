import { describe, expect, it, vi } from "vitest";

import type { AuthorizationAuthority, ReplaceManagedProductAuthorizationGrantsCommand } from "@opencrane/backend/server/iam/authorization";
import { AuthorizationDecisionOutcomes, ProductAuthorizationResourceKinds } from "@opencrane/models/authorization";

import { _ProjectProviderResourceCreatorUse } from "../provider-gateway-authorization";

describe("provider resource creator authorization", function _Suite()
{
	it("uses a different managed-grant owner for each creator Principal", async function _ScopesManagerByPrincipal()
	{
		const replaceManagedGrants = vi.fn(async function _Replace(_command: ReplaceManagedProductAuthorizationGrantsCommand) { return { outcome: AuthorizationDecisionOutcomes.Allow, changedCount: 3, evidence: {} }; });
		const authorization = { replaceManagedGrants } as unknown as AuthorizationAuthority;
		const resource = { kind: ProductAuthorizationResourceKinds.ProviderConnection, id: "byok:silo-a:openai" } as const;
		const now = new Date("2026-08-30T01:00:00.000Z");

		await _ProjectProviderResourceCreatorUse(authorization, { siloId: "silo-a", principalId: "principal-a" }, resource, now, "user", "principal-a");
		await _ProjectProviderResourceCreatorUse(authorization, { siloId: "silo-a", principalId: "principal-b" }, resource, now, "user", "principal-b");

		expect(replaceManagedGrants.mock.calls.map(function _Manager(call) { return call[0].managerId; })).toEqual([
			"provider-resource-creator-bootstrap:principal-a",
			"provider-resource-creator-bootstrap:principal-b",
		]);
		expect(replaceManagedGrants.mock.calls.map(function _Subject(call) { return call[0].grants[0]?.subject; })).toEqual([
			{ kind: "principal", principalId: "principal-a" },
			{ kind: "principal", principalId: "principal-b" },
		]);
	});
});
