/**
 * Selects the capability boundary that evaluates a grant.
 *
 * Each value routes to one typed grant shape and owning validator. These serialized contract values
 * are closed: an unknown kind has no validator and must not authorize a request.
 */
export enum AgentCapabilityGrantKinds
{
	/** Governs web traffic through the OpenCrane egress gateway. */
	WebEgress = "web_egress",
	/** Governs logical MCP discovery and invocation. */
	McpInvocation = "mcp_invocation",
	/** Governs a named OpenCrane service action. */
	OpenCraneService = "opencrane_service",
	/** Governs use of a brokered external provider connection. */
	ProviderConnection = "provider_connection",
}

/**
 * States whether a matching capability grant permits or rejects a request.
 *
 * Grant evaluation reads these values with time, scope, and current authority. A matching denial
 * wins over an allow, so callers must not use an allow record as a standalone permission result.
 */
export enum AgentCapabilityGrantEffects
{
	/** Allows the selected capability when no current denial wins. */
	Allow = "allow",
	/** Denies the selected capability even when an allow grant also matches. */
	Deny = "deny",
}

/**
 * Selects how a web-egress grant matches a normalized destination.
 *
 * The egress validator branches on this value before it permits outbound traffic. Unknown matching
 * rules must fail closed because the contract does not define their domain semantics.
 */
export enum WebDestinationSelectorKinds
{
	/** Matches one normalized DNS name. */
	ExactDomain = "exact_domain",
	/** Matches a normalized DNS suffix with an explicit apex choice. */
	SuffixDomain = "suffix_domain",
}

/** Lists the web protocols an egress validator may admit; values outside this closed set are denied. */
export enum WebEgressProtocols
{
	/** Admits encrypted Hypertext Transfer Protocol traffic. */
	Https = "https",
}

/** Lists the MCP actions an invocation validator may admit; an unknown action has no grant path. */
export enum McpInvocationActions
{
	/** Allows discovery of the approved MCP server catalog. */
	Discover = "discover",
	/** Allows invocation of approved MCP tools. */
	Invoke = "invoke",
}

/** Lists provider-connection operations that a brokered grant may admit. */
export enum ProviderConnectionActions
{
	/** Allows use of the named provider connection. */
	Use = "use",
}

/**
 * Describes one normalized destination that a web-egress grant may match.
 *
 * The selector separates exact names from suffixes so a validator does not silently broaden a grant
 * when it compares a subdomain with its apex.
 */
export interface WebDestinationSelector
{
	/** Selects the destination-matching strategy. */
	readonly kind: WebDestinationSelectorKinds;
	/** Stores the normalized Internationalized Domain Name. */
	readonly domain: string;
	/** States whether a suffix selector also matches its apex domain. */
	readonly includeApex: boolean;
}

/** Selects one OpenCrane service resource for a resource-scoped grant. */
export interface OpenCraneResourceSelector
{
	/** Identifies the selected resource when this grant is resource-specific. */
	readonly resourceId: string | null;
	/** Identifies the owning conversation when the resource is conversation-scoped. */
	readonly conversationId: string | null;
}

/**
 * Defines the shared coordinates for every agent capability grant.
 *
 * A grant describes a possible capability boundary, scope, and lifetime; its effect applies only
 * when the owning validator finds a matching request and current authority permits the evaluation.
 */
export interface AgentCapabilityGrant
{
	/** Names the persisted contract shape. */
	readonly schemaVersion: 1;
	/** Identifies this grant record. */
	readonly id: string;
	/** Identifies the silo that owns this grant. */
	readonly siloId: string;
	/** Identifies the agent identity subject to this grant. */
	readonly agentIdentityId: string;
	/** Optionally binds this grant to one conversation computer. */
	readonly computerId?: string;
	/** Selects the concrete validator and service owner. */
	readonly kind: AgentCapabilityGrantKinds;
	/** States whether this grant allows or denies a matching request. */
	readonly effect: AgentCapabilityGrantEffects;
	/** Records when this grant begins to apply. */
	readonly validFrom: string;
	/** Optionally records when this grant stops applying. */
	readonly expiresAt?: string;
	/** Identifies the principal that granted this capability. */
	readonly grantedByPrincipalId: string;
	/** Records the human-readable reason for this grant. */
	readonly reason: string;
}

/** Defines the destinations, protocols, and ports a web-egress validator evaluates. */
export interface WebEgressGrant extends AgentCapabilityGrant
{
	/** Selects the web-egress handler. */
	readonly kind: AgentCapabilityGrantKinds.WebEgress;
	/** Lists the normalized destinations this grant matches. */
	readonly destinations: readonly WebDestinationSelector[];
	/** Lists the admitted web protocols. */
	readonly protocols: readonly WebEgressProtocols[];
	/** Lists the admitted destination ports. */
	readonly ports: readonly number[];
}

/** Defines discovery and invocation actions for one logical MCP server. */
export interface McpInvocationGrant extends AgentCapabilityGrant
{
	/** Selects the MCP-invocation handler. */
	readonly kind: AgentCapabilityGrantKinds.McpInvocation;
	/** Identifies the logical MCP server. */
	readonly mcpServerId: string;
	/** Lists the admitted MCP actions. */
	readonly actions: readonly McpInvocationActions[];
	/** Lists admitted tool names when not all tools are admitted. */
	readonly toolNames: readonly string[];
	/** States whether every tool on the named server is admitted. */
	readonly allTools: boolean;
}

/** Defines actions at one named OpenCrane service boundary. */
export interface OpenCraneServiceGrant extends AgentCapabilityGrant
{
	/** Selects the OpenCrane-service handler. */
	readonly kind: AgentCapabilityGrantKinds.OpenCraneService;
	/** Identifies the service that authorizes this operation. */
	readonly serviceId: string;
	/** Names the service-owned resource family. */
	readonly resourceKind: string;
	/** Selects the service-owned resource scope. */
	readonly resourceSelector: OpenCraneResourceSelector;
	/** Lists the admitted service actions. */
	readonly actions: readonly string[];
}

/** Defines brokered use of one external provider connection. */
export interface ProviderConnectionGrant extends AgentCapabilityGrant
{
	/** Selects the provider-connection handler. */
	readonly kind: AgentCapabilityGrantKinds.ProviderConnection;
	/** Identifies the brokered provider connection. */
	readonly providerConnectionId: string;
	/** Lists the admitted provider-connection operations. */
	readonly actions: readonly ProviderConnectionActions[];
}
