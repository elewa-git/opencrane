import type { JsonValue } from "@opencrane/util";

/**
 * Literal, fully hydrated agent input produced deterministically in the control plane.
 *
 * A {@link RunInputSnapshot} holds only immutable ID references plus a `promptCompilerVersion`. The
 * TypeScript prompt compiler dereferences those records into this literal payload — persona
 * instructions, ordered messages, resolved tool schemas, the resolved model route, and literal
 * budget numbers — so the runtime never re-derives persona, prompt, or tool assembly and holds no
 * database access. The runtime consumes this payload as opaque delivered data.
 */
export interface CompiledRunInput
{
	/** Deterministic prompt-compiler version that produced and must consume this payload. */
	readonly promptCompilerVersion: string;
	/** Run this compiled input belongs to. */
	readonly runId: string;
	/** Positive attempt whose immutable snapshot produced this compiled input. */
	readonly attempt: number;
	/** Fully assembled system instructions: persona text plus resolved memory and resource context. */
	readonly instructions: string;
	/** Ordered conversation turns compiled from the snapshot's message references. */
	readonly messages: readonly CompiledMessage[];
	/** Tool schemas the bounded model loop may propose, ordered canonically by name. */
	readonly tools: readonly CompiledToolDefinition[];
	/** Resolved model route carrying no provider credential. */
	readonly model: CompiledModelRoute;
	/** Literal token, cost, tool-invocation, and wall-clock limits for the bounded loop. */
	readonly budget: CompiledBudget;
	/** SHA-256 digest of the canonical compiled payload excluding this field, in `sha256:<hex>` form. */
	readonly digest: string;
}

/** One compiled conversation turn delivered to the bounded model loop. */
export interface CompiledMessage
{
	/** Canonical turn role understood by the OpenAI-compatible adapter. */
	readonly role: "system" | "user" | "assistant" | "tool";
	/** Literal turn content compiled from the persisted message. */
	readonly content: string;
	/** Immutable multimodal artifact revisions introduced by this exact conversation turn. */
	readonly attachments: readonly CompiledMessageAttachment[];
}

/** Runtime-ready, pinned metadata for one message artifact reference. */
export interface CompiledMessageAttachment
{
	/** Immutable artifact revision selected when the run snapshot was admitted. */
	readonly artifactRevisionId: string;
	/** Published media type the runtime/preprocessor must handle. */
	readonly mediaType: string;
	/** Content-addressed bytes reference; never a mutable file path or download URL. */
	readonly contentAddress: string;
}

/** One resolved tool definition the bounded model loop may propose calling. */
export interface CompiledToolDefinition
{
	/** Stable tool name the model selects. */
	readonly name: string;
	/** Immutable tool revision the proposal is fixed to for later authorization. */
	readonly toolRevisionId: string;
	/** Human-readable tool description compiled from its revision. */
	readonly description: string;
	/** Whether an invocation of this tool must pause for a deferred human approval before dispatch. */
	readonly requiresApproval: boolean;
	/** JSON-Schema parameters object validated by the adapter, never by an implicit retry. */
	readonly parametersSchema: JsonValue;
}

/** Resolved model route delivered to the runtime, never carrying a provider credential. */
export interface CompiledModelRoute
{
	/** LiteLLM model alias the attempt-scoped virtual key is bound to. */
	readonly modelAlias: string;
	/** Maximum output tokens for one model request, or null when the route sets no ceiling. */
	readonly maxOutputTokens: number | null;
}

/** Literal aggregate limits OpenCrane enforces over the bounded loop. */
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
