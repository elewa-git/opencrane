import type { JsonValue } from "@opencrane/util";

/** Safe projections persisted with an approval for internal audit and generic elicitation display. */
export interface DeferredToolApprovalProjection
{
	/** Proposed arguments with schema-marked secret values omitted. */
	readonly proposedArguments: JsonValue;
	/** Decision response schema derived from the frozen reviewed parameters schema. */
	readonly responseSchema: JsonValue;
}
