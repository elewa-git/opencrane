import type { SignedFleetMembershipAssertionAuthority } from "@opencrane/backend/server/iam/membership";

/**
 * The one proxy operation channel-proxy may ask OpenCrane to resolve.
 *
 * Deliberately a single-member union: channel-proxy asks "may this browser read events on this
 * conversation, and where do I send that read?" and nothing else. Adding a member means a new
 * runtime receiver has to be registered and authorized too, so it is not a one-line change.
 *
 * @see {@link ChannelAuthorizedAction} for the product permission this maps onto.
 */
export type ChannelResolutionAction = "events.read";

/** Product authorization actions required by a proxy operation. */
export type ChannelAuthorizedAction = "conversation.read";

/**
 * The resolve request, assembled only by this package's internal HTTP adapter.
 *
 * `delegatedIdentity` is the security point of this type: the human subject is taken from the
 * browser session OpenCrane itself verified, never from a header channel-proxy set. The router
 * rejects the request outright when it carries any subject-asserting header, so a compromised proxy
 * cannot name a user it is not entitled to. `trustedHost` is likewise the host the proxy already
 * matched against the browser Origin, and it selects the silo - it is not a hint.
 *
 * Called by: __ResolveChannelTarget; built by `_parseCommand` in channel-targets.router.ts.
 */
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

/**
 * The fixed trust and lifetime rules for one resolver, taken only from deployment configuration.
 *
 * Nothing here can be influenced by a request, which is the point: the ServiceAccount name and
 * namespace decide who may call at all, the DNS suffixes stop a registered route from ever pointing
 * outside the cluster, and the receiver id and endpoint are chosen by the deployment rather than
 * discovered. `invocationContextTtlMs` is validated to be positive and at most 300000 (five
 * minutes), and the real expiry is the earlier of that and the caller's membership trust.
 *
 * Built by: `_CreateResolutionConfig` in apps/opencrane/src/app/channel-target-composition.ts.
 */
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

/**
 * Confirms the caller really is the channel-proxy workload, using a Kubernetes TokenReview.
 *
 * The projected ServiceAccount token from the Authorization header is sent to the API server, which
 * answers with the identity it belongs to. The adapter fixes the audience, ServiceAccount name and
 * namespace it will accept, so a token belonging to any other workload is rejected even though it is
 * perfectly valid. A null return means "not this workload" and must fail the request.
 *
 * Called by: __ResolveChannelTarget (step 2); implemented by _CreateChannelProxyTokenReviewer in
 * libs/backend/server/infra/workload-identity and wired in
 * apps/opencrane/src/app/channel-target-composition.ts.
 *
 * @see Kubernetes TokenReview, API group `authentication.k8s.io/v1` - the request this port makes.
 */
export interface ChannelWorkloadIdentityPort
{
	/** Reviews one projected token against the adapter's fixed audience and workload subject. */
	__Review(token: string): Promise<VerifiedChannelWorkloadIdentity | null>;
}

/**
 * Proof that OpenCrane itself verified which human is behind the proxied request.
 *
 * `trustworthySubject: true` and `source: "cookie"` are not decoration - they are the only shapes
 * the resolver accepts, and they can only be produced by code that read the verified OpenCrane
 * session cookie. Nothing here may ever be filled in from a header or body field supplied by
 * channel-proxy, because that would let the proxy choose whose events a caller can read.
 *
 * Built by: `_parseCommand` in channel-targets.router.ts from `request.session.authUser.sub`;
 * re-checked in __ResolveChannelTarget (step 3).
 */
export interface TrustedDelegatedBrowserIdentity
{
	/** Trustworthy issuer-bound human subject; never read from proxy assertions. */
	readonly subjectId: string;
	/** Credential mechanism OpenCrane successfully verified. */
	readonly source: "cookie";
	/** Explicit evidence that the adapter derived a trustworthy subject. */
	readonly trustworthySubject: true;
}

/** Exact silo bound to one trusted host. */
export interface TrustedHostSiloBinding
{
	/** Silo selected by the registered host authority. */
	readonly siloId: string;
}

/** Registered host-to-silo authority. */
export interface TrustedHostSiloPort
{
	/** Resolves one exact trusted host; unknown or ambiguous hosts return null. */
	resolveExactHost(trustedHost: string): Promise<TrustedHostSiloBinding | null>;
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

/**
 * Everything the database needs to hand out one short-lived pass for a single event read.
 *
 * `digest` is the SHA-256 of the opaque value channel-proxy receives; the value itself is never
 * stored, so a database dump cannot be replayed as a valid pass. Every other field is a binding
 * that will be re-checked inside the transaction before the row is inserted - which is why the
 * request repeats facts the resolver already checked. The conversation can close, a participant can
 * be removed, and a route can be retired between the check and the insert. `receiverId` and
 * `allowedRouteHostSuffixes` come from deployment configuration only, never from the request.
 *
 * Called by: __ResolveChannelTarget (step 7), through {@link ChannelTargetAuthorityRepository}.
 *
 * @see {@link IssueChannelInvocationContextResult} for the outcomes, including the re-check failures.
 */
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

/**
 * A runtime's request to spend one invocation context, made at the moment of the event read.
 *
 * The runtime acts here as the policy enforcement point (PEP): it holds no permission logic of its
 * own and simply presents the opaque value it was given, so this package makes the decision. Only
 * the digest is sent, and `expectedReceiverId` is the receiver identity configured on that runtime,
 * so a pass issued for one receiver cannot be spent at another. A context can be spent exactly once.
 *
 * Called by: the replay route in
 * libs/backend/server/conversations/main/src/conversation-replay.router.ts, which digests the
 * presented value with __DigestChannelInvocationContext first.
 *
 * @see {@link ConsumeChannelInvocationContextResult} for the outcomes and every denial reason.
 */
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

/**
 * The outcome of spending one invocation context, with the reason when it is refused.
 *
 * Every refusal fails closed, and the reasons are meant to be told apart in logs rather than shown
 * to a browser: `not_found` (no such digest), `receiver_mismatch` (issued for a different runtime),
 * `route_mismatch` (the stored route no longer agrees with the context's silo, service, or action),
 * `expired` (past its hard expiry), `revoked` (deliberately withdrawn), `replayed` (already spent -
 * treat as an attack signal, not as a retry), and `route_inactive` (the route was retired or
 * replaced). On `consumed` the caller must use the returned bindings, not its own request fields.
 *
 * @see {@link ConsumedChannelInvocationContext} for what the consumed case carries.
 */
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

/**
 * The durable authority for conversations, runtime routes, and invocation contexts.
 *
 * The `Atomically` suffix on two methods is a promise, not decoration: each of those runs entirely
 * inside one serializable transaction that re-reads the conversation, its participants and the
 * route, and only then writes. That is necessary because the resolver checks those same facts
 * outside any transaction, and a conversation can close or a participant can lose access in
 * between. The plain `getConversationAuthority` read is only a cheap early rejection - it is never
 * the decision.
 *
 * Called by: __ResolveChannelTarget and __ReconcileChannelTargetRoutes in this package, and the
 * replay route in libs/backend/server/conversations; implemented by
 * PrismaChannelTargetAuthorityUnitOfWork.
 *
 * @see {@link ChannelTargetAuthorityUnitOfWork} the alias used where the transaction matters.
 */
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

/**
 * The same operations as {@link ChannelTargetAuthorityRepository}, named for the implementation that
 * wraps each call in its own serializable transaction.
 *
 * Use this name in composition and app wiring to make it obvious that one call means one
 * transaction, and that the re-checks inside `issueInvocationContextAtomically` and
 * `consumeInvocationContextAtomically` really are protected against a concurrent change. The two
 * types are interchangeable; only the intent differs.
 *
 * Called by: apps/opencrane/src/app/channel-target-composition.ts and
 * apps/opencrane/src/app/runtime-composition.ts.
 */
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
	readonly membership: SignedFleetMembershipAssertionAuthority;
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

/**
 * The resolver's answer: one authorized route, or a refusal with a stable reason.
 *
 * Every refusal fails closed, and the reason picks the status the router returns: `workload_denied`
 * and `identity_denied` are 401, `route_denied` is 503 because nothing is wrong with the request -
 * no usable runtime route exists right now, so a retry can succeed - and everything else is 403.
 * `invalid_request` means the request or the resolver's own configuration failed validation before
 * any authority was consulted.
 *
 * @see {@link AuthorizedChannelTargetResult} for what the authorized case carries.
 */
export type ResolveChannelTargetResult =
	| { readonly outcome: "authorized"; readonly target: AuthorizedChannelTargetResult }
	| { readonly outcome: "denied"; readonly reason: "invalid_request" | "workload_denied" | "identity_denied" | "host_denied" | "membership_denied" | "conversation_denied" | "authorization_denied" | "route_denied" };
