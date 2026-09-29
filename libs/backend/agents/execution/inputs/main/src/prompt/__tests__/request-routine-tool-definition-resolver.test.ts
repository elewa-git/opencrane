import { CompiledToolDefinitionKinds, FIRST_PARTY_TOOL_CAPABILITY_CONTRACTS, FirstPartyToolCapabilities, type CompiledFirstPartyToolDefinition } from "@opencrane/contracts";
import { ___DigestCanonicalJson } from "@opencrane/util";
import { describe, expect, it } from "vitest";

import { RequestRoutineToolDefinitionResolver } from "../request-routine-tool-definition-resolver";

/** Build one strict first-party declaration for resolver tests. */
function _Descriptor(capability: FirstPartyToolCapabilities = FirstPartyToolCapabilities.RequestRoutine): CompiledFirstPartyToolDefinition
{
	const parametersSchema = { type: "object", additionalProperties: false } as const;
	return { kind: CompiledToolDefinitionKinds.FirstParty, capability, ...FIRST_PARTY_TOOL_CAPABILITY_CONTRACTS[capability], description: "Prepare a routine for review.", parametersSchema, parametersSchemaDigest: ___DigestCanonicalJson(parametersSchema) };
}

describe("RequestRoutineToolDefinitionResolver", function _RequestRoutineToolDefinitionResolverSuite()
{
	it("returns the injected descriptor only for the exact saved coordinate", function _ResolvesExactCoordinate()
	{
		const descriptor = _Descriptor();
		const resolver = new RequestRoutineToolDefinitionResolver(descriptor);

		expect(resolver.resolve([{ capability: descriptor.capability, capabilityRevision: descriptor.capabilityRevision, parametersSchemaDigest: descriptor.parametersSchemaDigest }])).toEqual([descriptor]);
		expect(resolver.resolve([])).toEqual([]);
	});

	it.each([
		{ capability: FirstPartyToolCapabilities.RequestRoutine, capabilityRevision: "opencrane:scheduling:request_routine:v2", parametersSchemaDigest: `sha256:${"a".repeat(64)}` },
		{ capability: FirstPartyToolCapabilities.RequestRoutine, capabilityRevision: FIRST_PARTY_TOOL_CAPABILITY_CONTRACTS[FirstPartyToolCapabilities.RequestRoutine].capabilityRevision, parametersSchemaDigest: `sha256:${"b".repeat(64)}` },
		{ capability: FirstPartyToolCapabilities.UpgradeSession, capabilityRevision: FIRST_PARTY_TOOL_CAPABILITY_CONTRACTS[FirstPartyToolCapabilities.UpgradeSession].capabilityRevision, parametersSchemaDigest: `sha256:${"a".repeat(64)}` },
	])("rejects a substituted saved coordinate", function _RejectsSubstitution(selection)
	{
		const resolver = new RequestRoutineToolDefinitionResolver(_Descriptor());
		expect(function _Resolve(): readonly CompiledFirstPartyToolDefinition[] { return resolver.resolve([selection]); }).toThrow();
	});

	it("rejects the unavailable upgrade-session declaration at composition", function _RejectsUpgradeSession()
	{
		expect(function _Construct(): RequestRoutineToolDefinitionResolver { return new RequestRoutineToolDefinitionResolver(_Descriptor(FirstPartyToolCapabilities.UpgradeSession)); }).toThrow(/request_routine/);
	});
});
