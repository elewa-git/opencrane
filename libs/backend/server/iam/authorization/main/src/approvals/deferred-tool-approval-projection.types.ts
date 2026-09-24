import type { ConversationToolProposal } from "@opencrane/contracts";
import type { JsonValue } from "@opencrane/util";

/** Safe projections persisted with an approval for internal audit and generic elicitation display. */
export interface DeferredToolApprovalProjection
{
	/** Complete display-safe arguments, or null when any proposed value must remain hidden. */
	readonly proposedArguments: ConversationToolProposal["arguments"] | null;
	/** Decision response schema derived from the frozen reviewed parameters schema. */
	readonly responseSchema: JsonValue;
}
