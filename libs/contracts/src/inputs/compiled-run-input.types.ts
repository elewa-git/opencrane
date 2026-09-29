import type { JsonValue } from "@opencrane/util";
import type { GeneratedOutputCapability } from "../model-routing/model-routing.types";
import type { RunBudgetPolicy } from "./run-budget-policy.types";
import type { CompiledFinalOutputModes } from "./compiled-final-output.types";

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
	/** Freezes how the gateway must decode the final answer; it is included in this input's digest. */
	readonly finalOutput: CompiledFinalOutputModes;
	/** Ordered conversation turns compiled from the snapshot's message references. */
	readonly messages: readonly CompiledMessage[];
	/** Closed callable schemas the model loop may select, sorted by their provider-facing model name. */
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
 * Identifies which authority owns a callable selected by the model.
 * Stored in the digest-sealed {@link CompiledRunInput}; changing a wire value breaks saved input replay.
 */
export enum CompiledToolDefinitionKinds
{
	/** An immutable MCP tool revision owns authorization and external dispatch. */
	Mcp = "mcp",
	/** OpenCrane owns a built-in capability with no MCP revision, grant, connection, or invocation. */
	FirstParty = "first_party",
}

/**
 * Built-in capabilities that may be frozen into a compiled run input.
 * Stored in first-party declarations; changing a wire value breaks saved input replay and dispatch.
 */
export enum FirstPartyToolCapabilities
{
	/** A selection may create a personal-configuration proposal for later human review. */
	UpgradeSession = "upgrade_session",
	/** A selection may create a requester-only routine draft; it never activates the routine. */
	RequestRoutine = "request_routine",
}

/**
 * Describes the maximum effect a built-in selection may have.
 * Stored in first-party declarations; changing a wire value breaks saved input replay.
 */
export enum FirstPartyToolEffectKinds
{
	/** The handler may save a proposal but may not apply or activate the proposed change. */
	ProposalOnly = "proposal_only",
}

/**
 * Describes how a built-in proposal may become active product state.
 * Stored in first-party declarations; changing a wire value breaks saved input replay.
 */
export enum FirstPartyToolMaterializationKinds
{
	/** The proposal remains inactive until a person reviews and confirms it through the product flow. */
	HumanReviewRequired = "human_review_required",
}

/** Declaration metadata for every built-in capability recognized by the compiled-input contract. */
export const FIRST_PARTY_TOOL_CAPABILITY_CONTRACTS = {
	[FirstPartyToolCapabilities.UpgradeSession]: { name: "upgrade_session", modelName: "upgrade_session", capabilityRevision: "opencrane:personal:upgrade_session:v1", effect: FirstPartyToolEffectKinds.ProposalOnly, materialization: FirstPartyToolMaterializationKinds.HumanReviewRequired },
	[FirstPartyToolCapabilities.RequestRoutine]: { name: "request_routine", modelName: "request_routine", capabilityRevision: "opencrane:scheduling:request_routine:v1", effect: FirstPartyToolEffectKinds.ProposalOnly, materialization: FirstPartyToolMaterializationKinds.HumanReviewRequired },
} as const satisfies Readonly<Record<FirstPartyToolCapabilities, { readonly name: string; readonly modelName: string; readonly capabilityRevision: string; readonly effect: FirstPartyToolEffectKinds; readonly materialization: FirstPartyToolMaterializationKinds }>>;

/** Fields shared by MCP and built-in callable declarations offered to the model. */
export interface CompiledToolDefinitionBase
{
	/** Selects the authority that may interpret this declaration after the model chooses it. */
	readonly kind: CompiledToolDefinitionKinds;
	/** Exact source name used for disclosure. */
	readonly name: string;
	/** Provider-compatible name used in the model declaration and returned selection; it grants no permission. */
	readonly modelName: string;
	/** Human-readable description included in the model declaration. */
	readonly description: string;
	/** JSON-Schema for the tool's parameters. The adapter validates against it; a retry never re-validates on its own. */
	readonly parametersSchema: JsonValue;
	/** Digest of the parameters schema, proving it matches the frozen callable declaration. */
	readonly parametersSchemaDigest: string;
}

/** An MCP tool revision frozen by run admission and dispatched only through the MCP authority. */
export interface CompiledMcpToolDefinition extends CompiledToolDefinitionBase
{
	readonly kind: CompiledToolDefinitionKinds.Mcp;
	/** Tool revision this call is pinned to, so authorization later checks the same revision. */
	readonly toolRevisionId: string;
	/** When true, dispatch pauses until a person approves this exact MCP invocation. */
	readonly requiresApproval: boolean;
}

/** A built-in proposal capability with no MCP authority coordinates or external dispatch. */
export interface CompiledFirstPartyToolDefinition extends CompiledToolDefinitionBase
{
	readonly kind: CompiledToolDefinitionKinds.FirstParty;
	/** Closed built-in capability selected by this declaration. */
	readonly capability: FirstPartyToolCapabilities;
	/** Stable revision of the capability semantics, independent of MCP tool revisions. */
	readonly capabilityRevision: string;
	/** Maximum effect the built-in handler may produce. */
	readonly effect: FirstPartyToolEffectKinds.ProposalOnly;
	/** Rule that must be satisfied before the proposal can affect active product state. */
	readonly materialization: FirstPartyToolMaterializationKinds.HumanReviewRequired;
}

/** One closed MCP or built-in callable declaration offered during this attempt. */
export type CompiledToolDefinition = CompiledMcpToolDefinition | CompiledFirstPartyToolDefinition;

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

/** The compiled request carries the exact admitted allowance without changing any ceiling. */
export type CompiledBudget = RunBudgetPolicy;
