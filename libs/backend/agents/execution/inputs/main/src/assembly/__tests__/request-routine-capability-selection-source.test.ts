import { AgentRunTriggers, CompiledToolDefinitionKinds, FIRST_PARTY_TOOL_CAPABILITY_CONTRACTS, FirstPartyToolCapabilities, type CompiledFirstPartyToolDefinition } from "@opencrane/contracts";
import { ___DigestCanonicalJson } from "@opencrane/util";
import { describe, expect, it } from "vitest";

import { RequestRoutineCapabilitySelectionSource } from "../request-routine-capability-selection-source";

/** Build the request-routine declaration that application composition injects. */
function _Descriptor(capability: FirstPartyToolCapabilities = FirstPartyToolCapabilities.RequestRoutine): CompiledFirstPartyToolDefinition
{
	const parametersSchema = { type: "object", additionalProperties: false } as const;
	return { kind: CompiledToolDefinitionKinds.FirstParty, capability, ...FIRST_PARTY_TOOL_CAPABILITY_CONTRACTS[capability], description: "Prepare a routine for review.", parametersSchema, parametersSchemaDigest: ___DigestCanonicalJson(parametersSchema) };
}

/** Call the selector with only the command facts its pure eligibility decision consumes. */
function _Load(source: RequestRoutineCapabilitySelectionSource, command: { readonly trigger: string; readonly conversationId: string | null; readonly messageInput: unknown })
{
	return source.load(command as never, {} as never, {} as never, {} as never, {} as never);
}

describe("RequestRoutineCapabilitySelectionSource", function _RequestRoutineCapabilitySelectionSourceSuite()
{
	it("selects the exact descriptor coordinate for an interactive human conversation", async function _SelectsInteractiveConversation()
	{
		const descriptor = _Descriptor();
		const source = new RequestRoutineCapabilitySelectionSource(descriptor);

		await expect(_Load(source, { trigger: AgentRunTriggers.Interactive, conversationId: "conversation-1", messageInput: { author: "human" } })).resolves.toEqual({ outcome: "loaded", value: [{ capability: FirstPartyToolCapabilities.RequestRoutine, capabilityRevision: descriptor.capabilityRevision, parametersSchemaDigest: descriptor.parametersSchemaDigest }] });
	});

	it.each([
		{ trigger: AgentRunTriggers.Scheduled, conversationId: "conversation-1", messageInput: null },
		{ trigger: AgentRunTriggers.Manual, conversationId: "conversation-1", messageInput: null },
		{ trigger: AgentRunTriggers.Interactive, conversationId: null, messageInput: null },
	])("keeps non-human and non-conversation work unavailable", async function _ExcludesNonInteractive(command)
	{
		await expect(_Load(new RequestRoutineCapabilitySelectionSource(_Descriptor()), command)).resolves.toEqual({ outcome: "loaded", value: [] });
	});

	it("rejects another built-in capability at composition", function _RejectsWrongCapability()
	{
		expect(function _Construct(): RequestRoutineCapabilitySelectionSource { return new RequestRoutineCapabilitySelectionSource(_Descriptor(FirstPartyToolCapabilities.UpgradeSession)); }).toThrow(/request_routine/);
	});
});
