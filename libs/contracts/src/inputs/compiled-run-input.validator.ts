import { z } from "zod";

import { ___DigestCanonicalJson, type JsonValue } from "@opencrane/util";

import { CompiledToolDefinitionKinds, FIRST_PARTY_TOOL_CAPABILITY_CONTRACTS, FirstPartyToolCapabilities, FirstPartyToolEffectKinds, FirstPartyToolMaterializationKinds, type CompiledFirstPartyToolDefinition, type CompiledMcpToolDefinition, type CompiledToolDefinition } from "./compiled-run-input.types";

/** Accepts JSON values without transforming the digest-bound schema. */
const _JsonValueSchema: z.ZodType<JsonValue> = z.lazy(function _JsonValue(): z.ZodType<JsonValue>
{
	return z.union([z.string(), z.number().finite(), z.boolean(), z.null(), z.array(_JsonValueSchema), z.record(_JsonValueSchema)]);
});

/** Requires a nonblank string without trimming digest-bound content. */
const _TextSchema = z.string().refine(function _Nonblank(value): boolean { return value.trim().length > 0; });

/** Requires the SHA-256 format used by canonical JSON digests. */
const _DigestSchema = z.string().regex(/^sha256:[0-9a-f]{64}$/u);

/** Fields shared by all compiled callable declarations. */
const _SharedFields = {
	name: _TextSchema,
	modelName: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/u),
	description: z.string(),
	parametersSchema: z.record(_JsonValueSchema),
	parametersSchemaDigest: _DigestSchema,
};

/** Validates one MCP declaration before it reaches MCP-only proposal and dispatch owners. */
export const ___CompiledMcpToolDefinitionSchema: z.ZodType<CompiledMcpToolDefinition> = z.object({
	kind: z.literal(CompiledToolDefinitionKinds.Mcp),
	..._SharedFields,
	toolRevisionId: _TextSchema,
	requiresApproval: z.boolean(),
}).strict();

/** Validates one built-in declaration and its frozen capability semantics. */
export const ___CompiledFirstPartyToolDefinitionSchema: z.ZodType<CompiledFirstPartyToolDefinition> = z.object({
	kind: z.literal(CompiledToolDefinitionKinds.FirstParty),
	..._SharedFields,
	capability: z.nativeEnum(FirstPartyToolCapabilities),
	capabilityRevision: _TextSchema,
	effect: z.literal(FirstPartyToolEffectKinds.ProposalOnly),
	materialization: z.literal(FirstPartyToolMaterializationKinds.HumanReviewRequired),
}).strict().superRefine(function _MatchesCapabilityContract(value, context): void
{
	const contract = FIRST_PARTY_TOOL_CAPABILITY_CONTRACTS[value.capability];
	if (value.name !== contract.name || value.modelName !== contract.modelName || value.capabilityRevision !== contract.capabilityRevision || value.effect !== contract.effect || value.materialization !== contract.materialization)
		context.addIssue({ code: z.ZodIssueCode.custom, message: "First-party callable semantics do not match the capability contract" });
});

/** Validates the source-specific shape and schema digest of a frozen callable declaration. */
export const ___CompiledToolDefinitionSchema: z.ZodType<CompiledToolDefinition> = z.union([___CompiledMcpToolDefinitionSchema, ___CompiledFirstPartyToolDefinitionSchema]).superRefine(function _MatchesSchemaDigest(value, context): void
{
	if (___DigestCanonicalJson(value.parametersSchema) !== value.parametersSchemaDigest)
		context.addIssue({ code: z.ZodIssueCode.custom, message: "Compiled callable schema digest does not match its parameters schema" });
});
