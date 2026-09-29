import { CompiledToolDefinitionKinds, FirstPartyToolCapabilities, ___CompiledFirstPartyToolDefinitionSchema, ___RunInputFirstPartyCapabilitySelectionsSchema, type CompiledFirstPartyToolDefinition, type RunInputFirstPartyCapabilitySelection } from "@opencrane/contracts";

import type { FirstPartyToolDefinitionResolver } from "./prompt-compiler.types";

/** Resolves the one request-routine declaration that composition made available at admission. */
export class RequestRoutineToolDefinitionResolver implements FirstPartyToolDefinitionResolver
{
	/** Exact immutable declaration returned only for a matching saved selection. */
	private readonly _descriptor: CompiledFirstPartyToolDefinition;

	/** Bind compilation to the same declaration used to select request_routine at admission. */
	constructor(descriptor: CompiledFirstPartyToolDefinition)
	{
		const parsed = ___CompiledFirstPartyToolDefinitionSchema.parse(descriptor);
		if (parsed.kind !== CompiledToolDefinitionKinds.FirstParty || parsed.capability !== FirstPartyToolCapabilities.RequestRoutine)
			throw new Error("Request-routine compilation requires the request_routine first-party declaration");
		this._descriptor = parsed;
	}

	/** Return the descriptor only when all digest-bound selection coordinates still match. */
	resolve(selections: readonly RunInputFirstPartyCapabilitySelection[]): readonly CompiledFirstPartyToolDefinition[]
	{
		const parsed = ___RunInputFirstPartyCapabilitySelectionsSchema.parse(selections);
		if (parsed.length === 0)
			return [];
		if (parsed.length !== 1)
			throw new Error("Request-routine compilation does not support another first-party capability");
		const selection = parsed[0]!;
		if (selection.capability !== FirstPartyToolCapabilities.RequestRoutine || selection.capabilityRevision !== this._descriptor.capabilityRevision || selection.parametersSchemaDigest !== this._descriptor.parametersSchemaDigest)
			throw new Error("Request-routine declaration does not match the admitted first-party capability");
		return [this._descriptor];
	}
}
