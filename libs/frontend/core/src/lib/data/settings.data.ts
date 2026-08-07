import { ModelClass, ModelInfo, SearchModeInfo, SettingsNavItem, SettingsSection } from "../models/settings.types";

/** Settings navigation items. */
export const SETTINGS_NAV: SettingsNavItem[] =
[
	{ id: SettingsSection.Pod, label: "Pod & Session", icon: "pi pi-user" },
	{ id: SettingsSection.Model, label: "Model & Budget", icon: "pi pi-bolt", badge: "82%" },
	{ id: SettingsSection.Awareness, label: "Awareness Contract", icon: "pi pi-book" },
	{ id: SettingsSection.Channels, label: "Harvest Channels", icon: "pi pi-wifi" },
	{ id: SettingsSection.Access, label: "Access & Datasets", icon: "pi pi-shield" },
	{ id: SettingsSection.Network, label: "Network & Egress", icon: "pi pi-shield" },
	{ id: SettingsSection.Account, label: "Account", icon: "pi pi-user" }
];

/** Models available for routing, with USD pricing per 1M tokens. */
export const MODELS: ModelInfo[] =
[
	{ id: "claude-haiku-4-5", provider: "Anthropic", label: "claude-haiku-4-5", inputPer1M: 0.25, outputPer1M: 1.25 },
	{ id: "claude-sonnet-4-6", provider: "Anthropic", label: "claude-sonnet-4-6", inputPer1M: 3, outputPer1M: 15 },
	{ id: "claude-opus-4-7", provider: "Anthropic", label: "claude-opus-4-7", inputPer1M: 15, outputPer1M: 75 },
	{ id: "gpt-4o-mini", provider: "OpenAI", label: "gpt-4o-mini", inputPer1M: 0.15, outputPer1M: 0.6 },
	{ id: "gpt-4o", provider: "OpenAI", label: "gpt-4o", inputPer1M: 2.5, outputPer1M: 10 },
	{ id: "o3-mini", provider: "OpenAI", label: "o3-mini", inputPer1M: 1.1, outputPer1M: 4.4 },
	{ id: "o3", provider: "OpenAI", label: "o3", inputPer1M: 10, outputPer1M: 40 },
	{ id: "gemini-2.0-flash", provider: "Google", label: "gemini-2.0-flash", inputPer1M: 0.1, outputPer1M: 0.4 },
	{ id: "gemini-2.5-pro", provider: "Google", label: "gemini-2.5-pro", inputPer1M: 1.25, outputPer1M: 10 },
	{ id: "llama-3.1-70b", provider: "Local", label: "llama-3.1-70b", inputPer1M: 0, outputPer1M: 0 },
	{ id: "deepseek-r1", provider: "Local", label: "deepseek-r1", inputPer1M: 0, outputPer1M: 0 }
];

/** Provider → accent colour for model chips. */
export const PROVIDER_COLORS: Record<string, string> =
{
	Anthropic: "#C84B31",
	OpenAI: "#5A8A5A",
	Google: "#4A6B8A",
	Local: "#7A766D"
};

/** Routed model classes with primary + fallbacks. */
export const MODEL_CLASSES: ModelClass[] =
[
	{ id: "routing", label: "Routing", color: "#7A766D", description: "Decides which model class to use for each incoming request.", hint: "Must be fast and cheap — this runs on every request.", primary: "claude-haiku-4-5", fallbacks: ["gpt-4o-mini"], enabled: true },
	{ id: "retrieval", label: "Retrieval", color: "#4A6B8A", description: "Generates embeddings and handles Cognee search queries.", hint: "Optimise for embedding quality and low latency.", primary: "gemini-2.0-flash", fallbacks: ["gpt-4o-mini"], enabled: true },
	{ id: "writing", label: "Writing", color: "#5A8A7A", description: "Long-form generation: docs, emails, summaries, canvas output.", hint: "Balance quality and cost — most session output goes through here.", primary: "claude-sonnet-4-6", fallbacks: ["gpt-4o", "gemini-2.5-pro"], enabled: true },
	{ id: "reasoning", label: "Reasoning", color: "#7A6AA0", description: "Analysis, synthesis, multi-step tasks, observation extraction.", hint: "Used when the router detects structured thinking is required.", primary: "claude-sonnet-4-6", fallbacks: ["o3-mini"], enabled: true },
	{ id: "high-reasoning", label: "High Reasoning", color: "#C84B31", description: "Complex decisions, planning, code generation, long-context reasoning.", hint: "Most expensive class — routed to sparingly. Requires explicit tool call.", primary: "claude-opus-4-7", fallbacks: ["o3", "gemini-2.5-pro"], enabled: true },
	{ id: "vision", label: "Vision", color: "#A0855A", description: "Image understanding, screenshot analysis, diagram reading.", hint: "Only invoked when a multimodal input is detected.", primary: "gpt-4o", fallbacks: ["claude-sonnet-4-6"], enabled: false }
];

/** Cognee search modes available per dataset. */
export const SEARCH_MODES: Record<string, SearchModeInfo> =
{
	vector: { label: "vector", hint: "Embedding similarity across chunks" },
	hybrid: { label: "hybrid", hint: "Vector + graph traversal combined" },
	graph_completion: { label: "graph_completion", hint: "LLM reasoning over extracted subgraph" },
	cypher: { label: "cypher", hint: "Direct Cypher query against graph DB" }
};
