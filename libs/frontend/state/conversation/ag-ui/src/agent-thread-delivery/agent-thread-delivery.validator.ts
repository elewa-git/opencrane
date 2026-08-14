import { AgentThreadDeliveryKinds } from "@opencrane/contracts";

import { _BoundedIdentifier } from "../bounded-value.validator";
import type { AgUiAgentThreadParentDelivery } from "./agent-thread-delivery.types";

/** Validate exact bounded display fields and reject every unexpected authority or provider field. */
export function _IsAgentThreadParentDelivery(value: unknown): value is AgUiAgentThreadParentDelivery
{
	if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
	const candidate = value as Record<string, unknown>;
	const keys = ["id", "childConversationId", "kind", "label", "detail", "assetId"];
	if (Object.keys(candidate).length !== keys.length || keys.some(function _Missing(key) { return !Object.hasOwn(candidate, key); })) return false;
	if (!_BoundedIdentifier(candidate["id"]) || !_BoundedIdentifier(candidate["childConversationId"])) return false;
	if (typeof candidate["kind"] !== "string" || !Object.values(AgentThreadDeliveryKinds).includes(candidate["kind"] as AgentThreadDeliveryKinds)) return false;
	if (typeof candidate["label"] !== "string" || candidate["label"].trim().length === 0 || candidate["label"].length > 160) return false;
	if (typeof candidate["detail"] !== "string" || candidate["detail"].trim().length === 0 || candidate["detail"].length > 4000) return false;
	return candidate["assetId"] === null || _BoundedIdentifier(candidate["assetId"]);
}
