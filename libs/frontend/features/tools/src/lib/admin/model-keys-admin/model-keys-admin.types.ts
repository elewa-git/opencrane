import { ModelProvider } from "@opencrane/state/provider-key/adapter";
import { ScopeChipTones } from "@opencrane/elements/ui";

/**
 * Per-provider row view model for the Model Keys table.
 *
 * Wraps the gateway's {@link ProviderKeyStatus} with the display label so the
 * template never maps an enum to a name inline.
 */
export interface ModelKeyRow
{
	/** The provider this row describes. */
	provider: ModelProvider;

	/** Human-friendly provider name (e.g. "OpenAI"). */
	label: string;

	/** Whether a key is currently set for this provider. */
	configured: boolean;

	/** Whether LiteLLM accepted the key on its dynamic path. */
	litellmRegistered: boolean;

	/** When the key was last set; null when not configured. */
	updatedAt: string | null;

	/** Human-friendly last-updated label, or "—" when never set. */
	updatedAtLabel: string;
}

/**
 * The LiteLLM registration state shown as a subtle badge: a registered key is
 * "active" on LiteLLM's dynamic path; an unregistered (but configured) key only
 * reached the k8s Secret.
 */
export enum LiteLlmBadge
{
	/** Key reached LiteLLM's dynamic path. */
	Active = "active",
	/** Key is stored as a Secret but LiteLLM has not registered it. */
	SecretOnly = "secretOnly",
	/** No key configured for this provider. */
	None = "none"
}

/** Visual style for a LiteLLM badge. */
export interface ModelKeyBadgeStyle
{
	/** Badge label. */
	label: string;

	/** Semantic shared-chip treatment. */
	tone: ScopeChipTones;
}

/** Display name for each provider, keyed by the gateway enum. */
export const MODEL_PROVIDER_LABELS: Record<ModelProvider, string> =
{
	[ModelProvider.OpenAi]: "OpenAI",
	[ModelProvider.Anthropic]: "Anthropic",
	[ModelProvider.Gemini]: "Gemini",
	[ModelProvider.Mistral]: "Mistral",
	[ModelProvider.DeepSeek]: "DeepSeek",
	[ModelProvider.Glm]: "GLM"
};

/** LiteLLM badge style, mapping each registration state onto a status colour. */
export const LITELLM_BADGE_STYLES: Record<LiteLlmBadge, ModelKeyBadgeStyle> =
{
	[LiteLlmBadge.Active]: { label: "LiteLLM: active", tone: ScopeChipTones.Success },
	[LiteLlmBadge.SecretOnly]: { label: "Secret-only", tone: ScopeChipTones.Warning },
	[LiteLlmBadge.None]: { label: "not configured", tone: ScopeChipTones.Neutral }
};
