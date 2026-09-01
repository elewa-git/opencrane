import type { AuthorizationBoundary, AuthorizationBoundaryCoverages } from "./authorization-boundary.types";
import type { AuthorizationDecision } from "./grant.types";

/**
 * Names every product resource class that can receive an OpenCrane authorization grant.
 *
 * These values become persisted `AuthorizationGrant.resourceKind` coordinates and are shared by
 * policy, audit, API projection, and CI enforcement. Adding or renaming a value therefore needs a
 * reviewed catalogue revision and a database migration when stored rows already use it.
 */
export enum ProductAuthorizationResourceKinds
{
	/** Protects one silo organisation and its product administration surface. */
	Organization = "organization",
	/** Protects durable grant administration without exposing a second policy vocabulary. */
	AuthorizationGrant = "authorization-grant",
	/** Protects a stable personal or managed agent service. */
	AgentService = "agent-service",
	/** Protects personal agent creation before an AgentService identifier exists. */
	AgentServiceCollection = "agent-service-collection",
	/** Protects one immutable agent revision. */
	AgentRevision = "agent-revision",
	/** Protects one durable run and its retry or cancellation lifecycle. */
	AgentRun = "agent-run",
	/** Protects one durable external-action invocation lifecycle. */
	ToolInvocation = "tool-invocation",
	/** Protects one public MCP task before complete arguments produce its ToolInvocation. */
	McpTask = "mcp-task",
	/** Protects one human approval request and its decision. */
	ApprovalRequest = "approval-request",
	/** Protects a stable skill identity. */
	Skill = "skill",
	/** Protects one immutable skill revision. */
	SkillRevision = "skill-revision",
	/** Protects a stable MCP server identity. */
	McpServer = "mcp-server",
	/** Protects one immutable MCP server image revision. */
	McpServerRevision = "mcp-server-revision",
	/** Protects one tool schema discovered from an immutable MCP server revision. */
	McpToolRevision = "mcp-tool-revision",
	/** Protects one registered model definition without exposing provider credentials. */
	ModelDefinition = "model-definition",
	/** Protects a stable artifact identity. */
	Artifact = "artifact",
	/** Protects creation inside one silo's artifact collection before an Artifact id exists. */
	ArtifactCollection = "artifact-collection",
	/** Protects one immutable artifact revision. */
	ArtifactRevision = "artifact-revision",
	/** Protects a durable knowledge dataset. */
	Dataset = "dataset",
	/** Protects a named personal or organisational memory boundary. */
	MemoryScope = "memory-scope",
	/** Protects a personal or managed agent persona definition. */
	Persona = "persona",
	/** Protects personal persona creation before a Persona profile identifier exists. */
	PersonaCollection = "persona-collection",
	/** Protects a durable conversation and its participant actions. */
	Conversation = "conversation",
	/** Protects creation inside one silo's conversation collection before a Conversation id exists. */
	ConversationCollection = "conversation-collection",
	/** Protects an outbound channel destination. */
	ChannelTarget = "channel-target",
	/** Protects use and administration of a provider connection without exposing its secret. */
	ProviderConnection = "provider-connection",
	/** Protects one agent schedule. */
	Schedule = "schedule",
	/** Protects one technical or spending budget. */
	Budget = "budget",
	/** Protects the silo's append-only audit decision catalogue. */
	AuditLog = "audit-log",
	/** Protects cost and token-usage reporting. */
	TokenUsage = "token-usage",
	/** Protects one governed external data-source definition. */
	ThirdPartySource = "third-party-source",
	/** Protects one explicit resource-sharing projection and its recipients. */
	ResourceShare = "resource-share",
	/** Protects one organisation Group and its direct membership. */
	Group = "group",
	/** Protects organisation membership and invitation administration. */
	OrganizationMembership = "organization-membership",
}

/**
 * Names the product actions understood by the central authorization authority.
 *
 * A resource supports only the actions declared by the product catalogue. These strings form part
 * of capability identifiers and audit evidence, so changing one requires a new catalogue revision.
 */
export enum ProductAuthorizationActions
{
	/** Lets a Principal learn that a resource exists in a catalogue. */
	Discover = "discover",
	/** Lets a Principal read the non-secret representation of a resource. */
	Read = "read",
	/** Lets a Principal create a resource of the declared kind. */
	Create = "create",
	/** Lets a Principal change mutable definition data. */
	Edit = "edit",
	/** Lets a Principal consume a resource without changing its definition. */
	Use = "use",
	/** Lets a Principal attach an immutable resource revision to another governed definition. */
	Assign = "assign",
	/** Lets a Principal record review evidence for a candidate revision. */
	Review = "review",
	/** Lets a Principal publish an immutable revision for use. */
	Publish = "publish",
	/** Lets a Principal invoke an agent or tool. */
	Invoke = "invoke",
	/** Lets a Principal create or change scheduled execution. */
	Schedule = "schedule",
	/** Lets a Principal admit a child or delegated execution. */
	Delegate = "delegate",
	/** Lets a Principal grant another subject access to a resource. */
	Share = "share",
	/** Lets a Principal send content to a governed channel target. */
	Send = "send",
	/** Lets a Principal stop a published revision or grant from future use. */
	Revoke = "revoke",
	/** Lets a Principal move a stable product definition to its retired lifecycle. */
	Retire = "retire",
	/** Lets a Principal request deletion under the resource's retention rules. */
	Delete = "delete",
	/** Lets a Principal remove retained memory content under its consent rules. */
	Forget = "forget",
	/** Lets a Principal change operational policy without receiving stored secrets. */
	Manage = "manage",
	/** Lets a Principal administer grants and lifecycle for the resource. */
	Administer = "administer",
	/** Lets a Principal import and install governed package content. */
	Install = "install",
	/** Lets a Principal stop a live or queued execution under its lifecycle rules. */
	Cancel = "cancel",
	/** Lets a Principal create a new fenced attempt for an eligible failed execution. */
	Retry = "retry",
	/** Lets a Principal decide a pending human approval without invoking the effect itself. */
	Decide = "decide",
}

/**
 * Selects the durable evidence required after an authorization decision.
 *
 * The value belongs to catalogue policy rather than a caller choice. It prevents a route from
 * silently treating an externally effectful action like an unrecorded catalogue read.
 */
export enum ProductAuthorizationEvidenceKinds
{
	/** A short read transaction may return the decision without appending one row per item. */
	Read = "read",
	/** The protected mutation and its append-only decision record commit together. */
	Decision = "decision",
	/** A one-use admitted command and replay receipt protect the later external effect. */
	Effect = "effect",
}

/** One allowed action and evidence rule in the product authorization catalogue. */
export interface ProductAuthorizationRule
{
	/** Product resource kind to which the rule applies. */
	readonly resourceKind: ProductAuthorizationResourceKinds;
	/** Product action that the resource supports. */
	readonly action: ProductAuthorizationActions;
	/** Evidence that must be written after an allow decision. */
	readonly evidence: ProductAuthorizationEvidenceKinds;
}

/** One immutable capability payload persisted in the built-in catalogue revision. */
export interface ProductAuthorizationCapabilityDefinition
{
	/** Stable resource-action capability identifier. */
	readonly id: string;
	/** Product resource kind protected by this capability. */
	readonly resourceKind: ProductAuthorizationResourceKinds;
	/** Singleton action list retained for the shared capability-catalog schema. */
	readonly actions: readonly ProductAuthorizationActions[];
	/** Evidence required when an allowed action is admitted. */
	readonly evidence: ProductAuthorizationEvidenceKinds;
}

/** A resource locator whose kind belongs to the reviewed product catalogue. */
export interface ProductAuthorizationResourceLocator
{
	/** Reviewed product resource kind. */
	readonly kind: ProductAuthorizationResourceKinds;
	/** Stable identifier interpreted by the owning product domain. */
	readonly id: string;
}

/** One typed request evaluated for an authenticated local Principal. */
export interface ProductAuthorizationCommand
{
	/** Silo derived from the trusted host and current membership state. */
	readonly siloId: string;
	/** Durable local Principal that performs the action. */
	readonly principalId: string;
	/** Product boundary supplied from trusted resource data. */
	readonly boundary: AuthorizationBoundary;
	/** Optional minimum coverage required when a Group subtree is being assigned. */
	readonly requiredBoundaryCoverage?: AuthorizationBoundaryCoverages;
	/** Typed product resource targeted by the action. */
	readonly resource: ProductAuthorizationResourceLocator;
	/** Typed action requested on the resource. */
	readonly action: ProductAuthorizationActions;
	/** Trusted database or server time used for grant validity. */
	readonly nowEpochMs: number;
}

/** Central authority result with the catalogue rule that determined receipt requirements. */
export interface ProductAuthorizationResult extends AuthorizationDecision
{
	/** Catalogue rule for the requested resource and action. */
	readonly rule: ProductAuthorizationRule | null;
}
