import { describe, expect, it } from "vitest";

import { ___DigestCanonicalJson } from "@opencrane/util";

import { CompiledToolDefinitionKinds, FIRST_PARTY_TOOL_CAPABILITY_CONTRACTS, FirstPartyToolCapabilities } from "../compiled-run-input.types";
import { ___CompiledFirstPartyToolDefinitionSchema, ___CompiledMcpToolDefinitionSchema, ___CompiledToolDefinitionSchema } from "../compiled-run-input.validator";

/** Builds one schema-bound MCP declaration. */
function _Mcp()
{
	const parametersSchema = { type: "object", additionalProperties: false } as const;
	return { kind: CompiledToolDefinitionKinds.Mcp, name: "records.read", modelName: "mcp_records_read", toolRevisionId: "revision-1", description: "Read records.", requiresApproval: true, parametersSchema, parametersSchemaDigest: ___DigestCanonicalJson(parametersSchema) } as const;
}

/** Builds the reviewed-form capability without any MCP authority coordinates. */
function _FirstParty()
{
	const parametersSchema = { type: "object", properties: { instruction: { type: "string" } }, required: ["instruction"], additionalProperties: false } as const;
	const contract = FIRST_PARTY_TOOL_CAPABILITY_CONTRACTS[FirstPartyToolCapabilities.RequestRoutine];
	return { kind: CompiledToolDefinitionKinds.FirstParty, capability: FirstPartyToolCapabilities.RequestRoutine, ...contract, description: "Prepare a routine for human review.", parametersSchema, parametersSchemaDigest: ___DigestCanonicalJson(parametersSchema) } as const;
}

describe("compiled callable declaration validation", function _CompiledCallableValidation()
{
	it("keeps MCP authority fields on only the MCP variant", function _McpVariant()
	{
		expect(___CompiledMcpToolDefinitionSchema.parse(_Mcp())).toEqual(_Mcp());
		expect(___CompiledFirstPartyToolDefinitionSchema.safeParse(_Mcp()).success).toBe(false);
	});

	it("accepts a built-in proposal only with the registered revision and review semantics", function _FirstPartyContract()
	{
		const declaration = _FirstParty();
		expect(___CompiledToolDefinitionSchema.parse(declaration)).toEqual(declaration);
		expect(___CompiledToolDefinitionSchema.safeParse({ ...declaration, modelName: "upgrade_session" }).success).toBe(false);
		expect(___CompiledToolDefinitionSchema.safeParse({ ...declaration, capabilityRevision: "invented" }).success).toBe(false);
		expect(___CompiledToolDefinitionSchema.safeParse({ ...declaration, materialization: "automatic" }).success).toBe(false);
	});

	it("rejects cross-source fields instead of treating a built-in proposal as an MCP invocation", function _RejectsMixedAuthority()
	{
		const declaration = _FirstParty();
		expect(___CompiledToolDefinitionSchema.safeParse({ ...declaration, toolRevisionId: "fake-revision", requiresApproval: false }).success).toBe(false);
		expect(___CompiledToolDefinitionSchema.safeParse({ ..._Mcp(), capability: FirstPartyToolCapabilities.RequestRoutine }).success).toBe(false);
	});

	it("rejects a callable whose frozen schema does not match its digest", function _RejectsSchemaDrift()
	{
		expect(___CompiledToolDefinitionSchema.safeParse({ ..._FirstParty(), parametersSchema: { type: "object", additionalProperties: true } }).success).toBe(false);
	});
});
