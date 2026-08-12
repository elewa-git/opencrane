import type { JsonValue } from "@opencrane/util";
import type { GeneratedOutputCapability } from "./model-routing.types.js";

/**
 * Agent input with every reference already resolved to a literal value, built in the control plane.
 *
 * A {@link RunInputSnapshot} holds only immutable ID references plus a `promptCompilerVersion`. The
 * TypeScript prompt compiler dereferences those records into this literal payload — persona
 * instructions, ordered messages, resolved tool schemas, the resolved model route, and literal
 * budget numbers — so the runtime never re-derives persona, prompt, or tool assembly and holds no
 * database access. The runtime consumes this payload as opaque delivered data.
 */
export interface CompiledRunInput
{
	/** Version of the prompt compiler that built this payload; the runtime must be on the same version. */
	readonly promptCompilerVersion: string;
	/** Run this compiled input belongs to. */
	readonly runId: string;
	/** Attempt number whose snapshot this input was compiled from. @see {@link RunInputSnapshot} */
	readonly attempt: number;
	/** The complete system prompt: persona text plus the memory and resource context already looked up for this run. */
	readonly instructions: string;
	/** Ordered conversation turns compiled from the snapshot's message references. */
	readonly messages: readonly CompiledMessage[];
	/** Tool schemas the model loop may call, sorted by name. */
	readonly tools: readonly CompiledToolDefinition[];
	/** Resolved model route carrying no provider credential. */
	readonly model: CompiledModelRoute;
	/** Literal token, cost, tool-invocation, and wall-clock limits for the bounded loop. */
	readonly budget: CompiledBudget;
	/** SHA-256 digest of this payload in RFC 8785 canonical form, with this field itself left out, written as `sha256:<hex>`. @see https://www.rfc-editor.org/rfc/rfc8785 */
	readonly digest: string;
}

/** One conversation turn given to the model loop, already flattened to a role and plain text. */
export interface CompiledMessage
{
	/** Canonical turn role understood by the OpenAI-compatible adapter. */
	readonly role: "system" | "user" | "assistant" | "tool";
	/** Literal turn content compiled from the persisted message. */
	readonly content: string;
}

/**
 * One tool the model loop may call during this attempt.
 *
 * The list is closed: a call to any other name is rejected. `requiresApproval` decides whether
 * a call pauses for a person before dispatch, and `parametersSchemaDigest` lets the server prove
 * the schema still matches the pinned revision when it authorizes the call.
 */
export interface CompiledToolDefinition
{
	/** Stable tool name the model selects. */
	readonly name: string;
	/** Tool revision this call is pinned to, so authorization later checks the same revision. */
	readonly toolRevisionId: string;
	/** Human-readable tool description compiled from its revision. */
	readonly description: string;
	/** When true, a call to this tool pauses and waits for a person to approve it before it is sent. */
	readonly requiresApproval: boolean;
	/** JSON-Schema for the tool's parameters. The adapter validates against it; a retry never re-validates on its own. */
	readonly parametersSchema: JsonValue;
	/** Digest of the parameters schema, proving it matches the pinned revision and the run snapshot. @see RunInputSnapshot */
	readonly parametersSchemaDigest: string;
}

/** Which model the runtime calls, and its output cap. It never carries a provider credential. */
export interface CompiledModelRoute
{
	/** LiteLLM model alias. This attempt's virtual key is restricted to it, so no other model can be called. */
	readonly modelAlias: string;
	/** Maximum output tokens for one model request, or null when the route sets no ceiling. */
	readonly maxOutputTokens: number | null;
	/** Server-admitted provider-native generated outputs frozen into this run. */
	readonly generatedOutputCapabilities: GeneratedOutputCapability[];
}

/** Limits OpenCrane enforces across the whole attempt. */
export interface CompiledBudget
{
	/** Maximum total tokens across the attempt, or null when uncapped. */
	readonly maxTotalTokens: number | null;
	/** Maximum spend in micro-US-dollars across the attempt, or null when uncapped. */
	readonly maxCostUsdMicros: number | null;
	/** Maximum external tool invocations across the attempt, or null when uncapped. */
	readonly maxToolInvocations: number | null;
	/** Wall-clock deadline for the attempt in epoch milliseconds, or null when unbounded here. */
	readonly wallClockDeadlineEpochMs: number | null;
}
