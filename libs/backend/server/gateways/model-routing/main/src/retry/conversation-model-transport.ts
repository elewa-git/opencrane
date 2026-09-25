import type { ConversationModelRequest, ConversationModelResponse } from "@opencrane/contracts";

import { _RequestConversationModel } from "../core/conversation-model";
import type { ConversationModelTransport } from "./conversation-model-proxy.types";
import { _ReadConversationModelProxyQualification } from "./conversation-model-proxy.validator";

/**
 * Builds the server's single-send adapter and captures its deployment qualification once.
 * Shared, stock and custom proxies remain unqualified unless the managed image contract is met by
 * deployment composition. Callers cannot change qualification through request data.
 * @throws Error during bootstrap when qualification is incomplete or names a different endpoint.
 */
export function __CreateConversationModelTransport(environment: Readonly<Record<string, string | undefined>>): ConversationModelTransport
{
	const qualification = _ReadConversationModelProxyQualification(environment);
	return {
		request(input: ConversationModelRequest): Promise<ConversationModelResponse>
		{
			return _RequestConversationModel(input, qualification);
		},
	};
}
