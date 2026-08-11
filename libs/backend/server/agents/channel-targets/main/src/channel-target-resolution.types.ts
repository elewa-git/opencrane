import type { AuthorizationScope } from "@opencrane/models/authorization";

/** Stable proxy operation presented to OpenCrane for resolution. */
export type ChannelResolutionAction = "events.read";

/** Product authorization actions required by a proxy operation. */
export type ChannelAuthorizedAction = "conversation.read";

/** Trusted input assembled only by the internal HTTP adapter. */
export interface ResolveChannelTargetCommand
{
	/** Projected channel-proxy ServiceAccount token. */
	readonly workloadToken: string;
	/** Browser identity already verified by OpenCrane's shared session middleware. */
	readonly delegatedIdentity: TrustedDelegatedBrowserIdentity;
	/** Exact host already bound to the browser Origin by channel-proxy. */
	readonly trustedHost: string;
	/** Target-neutral proxy operation. */
	readonly action: ChannelResolutionAction;
	/** Existing canonical conversation selected by the browser. */
	readonly conversationId: string;
	/** Optional persisted replay cursor for event reads. */
	readonly cursor?: string;
}

/** Fixed trust and lifetime policy for one OpenCrane resolver instance. */
export interface ChannelTargetResolutionConfig
{
	/** TokenReview audience required from channel-proxy. */
	readonly workloadAudience: "opencrane";
	/** Exact ServiceAccount name allowed to call the resolver. */
	readonly channelProxyServiceAccountName: string;
	/** Exact namespace containing the allowed channel-proxy workload. */
	readonly channelProxyNamespace: string;
	/** Maximum opaque invocation-context lifetime. */
	readonly invocationContextTtlMs: number;
	/** Internal DNS suffixes permitted for registered runtime endpoints. */
	readonly allowedRouteHostSuffixes: readonly string[];
	/** Stable receiver identity shared by every per-service route to this replay runtime. */
	readonly receiverId: string;
	/** Exact deployment-owned endpoint reconciled for every service route. */
	readonly receiverEndpoint: string;
}

/** Verified projected workload identity returned by TokenReview. */
export interface VerifiedChannelWorkloadIdentity
{
	/** Exact Kubernetes username returned by TokenReview. */
	readonly username: string;
	/** TokenReview-confirmed ServiceAccount name. */
	readonly serviceAccountName: string;
	/** TokenReview-confirmed ServiceAccount namespace. */
	readonly namespace: string;
	/** Audiences accepted by the Kubernetes API server. */
	readonly audiences: readonly string[];
}

/** Fail-closed TokenReview result. */
export type ChannelWorkloadIdentityDecision =
	| { readonly outcome: "trusted"; readonly identity: VerifiedChannelWorkloadIdentity }
	| { readonly outcome: "denied"; readonly reason: string };

/** TokenReview boundary implemented by the OpenCrane Kubernetes adapter. */
export interface ChannelWorkloadIdentityPort
{
	/** Reviews one projected token for the fixed OpenCrane audience. */
	review(token: string, audience: "opencrane"): Promise<ChannelWorkloadIdentityDecision>;
}

/** Verified browser subject produced by OpenCrane-owned identity validation. */
export interface TrustedDelegatedBrowserIdentity
{
	/** Trustworthy issuer-bound human subject; never read from proxy assertions. */
	readonly subjectId: string;
	/** Credential mechanism OpenCrane successfully verified. */
	readonly source: "cookie";
	/** Explicit evidence that the adapter derived a trustworthy subject. */
	readonly trustworthySubject: true;
}

/** Exact silo and authorization scope bound to one trusted host. */
export interface TrustedHostSiloBinding
{
	/** Silo selected by the registered host authority. */
	readonly siloId: string;
	/** Independent scope under which membership and grants are evaluated. */
	readonly authorizationScope: AuthorizationScope;
}

/** Registered host-to-silo authority. */
export interface TrustedHostSiloPort
{
	/** Resolves one exact trusted host; unknown or ambiguous hosts return null. */
	resolveExactHost(trustedHost: string): Promise<TrustedHostSiloBinding | null>;
}

/** Current signed membership result for one exact human and silo. */
export type ChannelMembershipDecision =
	| { readonly outcome: "trusted"; readonly revision: number; readonly trustedUntilEpochMs: number }
	| { readonly outcome: "denied"; readonly reason: string };

/** Signed fleet-membership boundary. */
export interface ChannelMembershipPort
{
	/** Requires the current signed membership revision for the exact scope. */
	verifyCurrentMembership(subjectId: string, siloId: string, scope: AuthorizationScope, nowEpochMs: number): Promise<ChannelMembershipDecision>;
}

/** Current canonical conversation coordinates needed before action authorization. */
export interface ChannelConversationAuthority
{
	/** Canonical conversation identifier. */
	readonly conversationId: string;
	/** Silo that owns the conversation. */
	readonly siloId: string;
	/** AgentService bound immutably to the conversation. */
	readonly agentServiceId: string;
	/** Immutable mode eligible for runtime event projection. */
	readonly mode: "agent_session";
	/** Current conversation lifecycle. */
	readonly lifecycle: "open" | "closed";
	/** Users explicitly participating in the conversation. */
	readonly participantUserIds: readonly string[];
}

/** Exact authorization request after membership and conversation binding. */
export interface AuthorizeChannelActionsCommand
{
	/** Verified human subject. */
	readonly subjectId: string;
	/** Host-selected silo. */
	readonly siloId: string;
	/** Canonical bound conversation. */
	readonly conversationId: string;
	/** AgentService bound to the conversation. */
	readonly agentServiceId: string;
	/** Independent authorization scope selected by the trusted host. */
	readonly scope: AuthorizationScope;
	/** Complete action set; every entry must be allowed. */
	readonly requiredActions: readonly ChannelAuthorizedAction[];
	/** Signed membership revision used by this decision. */
	readonly membershipRevision: number;
	/** Trusted current time. */
	readonly nowEpochMs: number;
}

/** Fail-closed action-authorization result. */
export type ChannelActionAuthorizationDecision =
	| { readonly outcome: "allowed"; readonly authorizationDigest: string }
	| { readonly outcome: "denied"; readonly reason: string };

/** Product authorization facade for channel actions. */
export interface ChannelActionAuthorizationPort
{
	/** Allows only when every requested action is currently authorized. */
	authorize(command: AuthorizeChannelActionsCommand): Promise<ChannelActionAuthorizationDecision>;
}

/** Atomic invocation-context issuance request. */
export interface IssueChannelInvocationContextCommand
{
	/** SHA-256 digest of the opaque context returned to channel-proxy. */
	readonly digest: string;
	/** Verified human subject and required conversation participant. */
	readonly subjectId: string;
	/** Expected host-selected silo. */
	readonly siloId: string;
	/** Expected canonical conversation. */
	readonly conversationId: string;
	/** Expected conversation-bound AgentService. */
	readonly agentServiceId: string;
	/** Exact channel operation being authorized. */
	readonly action: ChannelResolutionAction;
	/** Signed membership revision accepted by authorization. */
	readonly membershipRevision: number;
	/** Digest of the exact authorization decision. */
	readonly authorizationDigest: string;
	/** Trusted issuance instant. */
	readonly nowEpochMs: number;
	/** Hard expiry bounded by both configured TTL and membership trust. */
	readonly expiresAtEpochMs: number;
	/** Internal DNS suffixes the selected registered endpoint must satisfy before insertion. */
	readonly allowedRouteHostSuffixes: readonly string[];
	/** Stable receiver selected by deployment configuration, never request input. */
	readonly receiverId: string;
}

/** Exact selected route returned only after atomic authority revalidation. */
export interface IssuedChannelInvocationContext
{
	/** Durable invocation-context row identifier. */
	readonly id: string;
	/** Controller-registered route identifier. */
	readonly routeId: string;
	/** Stable runtime receiver bound independently of the per-service route row. */
	readonly receiverId: string;
	/** Exact registered internal endpoint; never derived by the resolver. */
	readonly endpoint: string;
}

/** Atomic issuance outcome. */
export type IssueChannelInvocationContextResult =
	| { readonly status: "issued"; readonly context: IssuedChannelInvocationContext }
	| { readonly status: "conversation_conflict" | "participant_conflict" | "route_unavailable" | "route_ambiguous" };

/** Online runtime-PEP consumption request. */
export interface ConsumeChannelInvocationContextCommand
{
	/** SHA-256 digest of the presented opaque context. */
	readonly digest: string;
	/** Stable receiver identity configured on the consuming runtime. */
	readonly expectedReceiverId: string;
	/** Trusted consumption instant. */
	readonly nowEpochMs: number;
}

/** Durable authority returned to the runtime PEP after one-time consumption. */
export interface ConsumedChannelInvocationContext
{
	/** Exact per-service route evidence consumed online. */
	readonly routeId: string;
	/** Stable runtime receiver independently bound to that route evidence. */
	readonly receiverId: string;
	/** Verified delegated human subject. */
	readonly subjectId: string;
	/** Bound silo. */
	readonly siloId: string;
	/** Bound conversation. */
	readonly conversationId: string;
	/** Bound AgentService. */
	readonly agentServiceId: string;
	/** Bound operation. */
	readonly action: ChannelResolutionAction;
	/** Authorization evidence digest. */
	readonly authorizationDigest: string;
}

/** One-time online consumption outcome. */
export type ConsumeChannelInvocationContextResult =
	| { readonly status: "consumed"; readonly context: ConsumedChannelInvocationContext }
	| { readonly status: "denied"; readonly reason: "not_found" | "receiver_mismatch" | "route_mismatch" | "expired" | "revoked" | "replayed" | "route_inactive" };

/** Deployment-owned route receiver reconciled across current AgentServices at startup. */
export interface ReconcileChannelRuntimeRoutesCommand
{
	/** Stable receiver shared by all service-specific rows. */
	readonly receiverId: string;
	/** Exact internal replay endpoint owned by that receiver. */
	readonly endpoint: string;
	/** Only this operation is currently served by the replay receiver. */
	readonly action: "events.read";
	/** Internal DNS suffixes enforced before any route mutation. */
	readonly allowedRouteHostSuffixes: readonly string[];
}

/** Durable conversation, route, and invocation-context authority. */
export interface ChannelTargetAuthorityRepository
{
	/** Loads current conversation coordinates for pre-authorization checks. */
	getConversationAuthority(conversationId: string): Promise<ChannelConversationAuthority | null>;
	/** Reconciles one service-specific route per current AgentService for the deployment receiver. */
	reconcileRuntimeRoutes(command: ReconcileChannelRuntimeRoutesCommand): Promise<number>;
	/** Rechecks conversation, participant, and selected route while inserting the digest. */
	issueInvocationContextAtomically(command: IssueChannelInvocationContextCommand): Promise<IssueChannelInvocationContextResult>;
	/** Consumes one digest once while rechecking the exact registered route online. */
	consumeInvocationContextAtomically(command: ConsumeChannelInvocationContextCommand): Promise<ConsumeChannelInvocationContextResult>;
}

/** Owns the serializable transaction that fences one channel-target authority operation. */
export type ChannelTargetAuthorityUnitOfWork = ChannelTargetAuthorityRepository;

/** Injectable wall clock. */
export interface ChannelTargetClock
{
	/** Returns trusted epoch-millisecond time. */
	nowEpochMs(): number;
}

/** Injectable opaque-secret source. */
export interface ChannelOpaqueContextSource
{
	/** Returns a cryptographically random opaque bearer value. */
	create(): string;
}

/** Resolver dependency graph with no implicit production fallback. */
export interface ChannelTargetResolutionDependencies
{
	/** Fixed trust and lifetime policy. */
	readonly config: ChannelTargetResolutionConfig;
	/** Projected workload TokenReview port. */
	readonly workloadIdentity: ChannelWorkloadIdentityPort;
	/** Exact host registration port. */
	readonly hostSilo: TrustedHostSiloPort;
	/** Signed membership authority. */
	readonly membership: ChannelMembershipPort;
	/** Product action authorization facade. */
	readonly authorization: ChannelActionAuthorizationPort;
	/** Canonical conversation, route, and context repository. */
	readonly repository: ChannelTargetAuthorityRepository;
	/** Trusted clock. */
	readonly clock: ChannelTargetClock;
	/** Cryptographically random opaque-context source. */
	readonly opaqueContext: ChannelOpaqueContextSource;
}

/** Successful resolver response consumed by channel-proxy. */
export interface AuthorizedChannelTargetResult
{
	/** Canonical verified subject used by proxy rate limiting. */
	readonly subjectId: string;
	/** Exact currently registered runtime endpoint. */
	readonly endpoint: string;
	/** Short-lived opaque context; only its digest is persisted. */
	readonly invocationContext: string;
	/** RFC3339 hard expiry. */
	readonly expiresAt: string;
}

/** Stable fail-closed resolution outcome. */
export type ResolveChannelTargetResult =
	| { readonly outcome: "authorized"; readonly target: AuthorizedChannelTargetResult }
	| { readonly outcome: "denied"; readonly reason: "invalid_request" | "workload_denied" | "identity_denied" | "host_denied" | "membership_denied" | "conversation_denied" | "authorization_denied" | "route_denied" };
