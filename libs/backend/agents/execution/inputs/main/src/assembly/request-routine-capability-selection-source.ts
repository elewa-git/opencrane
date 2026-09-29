import { AgentRunTriggers, CompiledToolDefinitionKinds, FirstPartyToolCapabilities, ___CompiledFirstPartyToolDefinitionSchema, type CompiledFirstPartyToolDefinition, type RunInputFirstPartyCapabilitySelection } from "@opencrane/contracts";

import { SessionAssemblyLoadOutcomes, type FirstPartyCapabilitySelectionSource } from "./session-assembly.types";

/** Selects the injected request-routine declaration for an admitted human conversation run. */
export class RequestRoutineCapabilitySelectionSource implements FirstPartyCapabilitySelectionSource
{
	/** Declaration already validated against the closed capability contract. */
	private readonly _selection: RunInputFirstPartyCapabilitySelection;

	/** Bind selection to the exact request-routine schema that later compilation must resolve. */
	constructor(descriptor: CompiledFirstPartyToolDefinition)
	{
		const parsed = ___CompiledFirstPartyToolDefinitionSchema.parse(descriptor);
		if (parsed.kind !== CompiledToolDefinitionKinds.FirstParty || parsed.capability !== FirstPartyToolCapabilities.RequestRoutine)
			throw new Error("Request-routine selection requires the request_routine first-party declaration");
		this._selection = { capability: parsed.capability, capabilityRevision: parsed.capabilityRevision, parametersSchemaDigest: parsed.parametersSchemaDigest };
	}

	/** Freeze request_routine only for a verified interactive conversation admission. */
	async load(...[command]: Parameters<FirstPartyCapabilitySelectionSource["load"]>): ReturnType<FirstPartyCapabilitySelectionSource["load"]>
	{
		if (command.trigger !== AgentRunTriggers.Interactive || command.conversationId === null || command.messageInput === null)
			return { outcome: SessionAssemblyLoadOutcomes.Loaded, value: [] };
		return { outcome: SessionAssemblyLoadOutcomes.Loaded, value: [this._selection] };
	}
}
