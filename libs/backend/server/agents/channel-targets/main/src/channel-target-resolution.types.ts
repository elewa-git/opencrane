import type { AuthorizationScope } from "@opencrane/models/authorization";

/** Stable proxy operation presented to OpenCrane for resolution. */
export type ChannelResolutionAction = "command.forward" | "events.read";

/** Product authorization actions required by a proxy operation. */
export type ChannelAuthorizedAction = "agent.run.start" | "thread.message.create" | "thread.read";

/** Trusted input assembled only by the internal HTTP adapter. */
export interface ResolveChannelTargetCommand
{
	/** Projected channel-proxy ServiceAccount token. */
	readonly workloadToken: string;
	/** Raw browser cookie header, when supplied. */
	readonly cookie?: string;
	/** Delegated browser authorization value, used only when no cookie is supplied. */
	readonly delegatedAuthorization?: string;
	/** Exact host already bound to the browser Origin by channel-proxy. */
	readonly trustedHost: string;
	/** Target-neutral proxy operation. */
	readonly action: ChannelResolutionAction;
	/** Existing canonical thread selected by the browser. */
	readonly threadId: string;
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
	readonly source: "cookie" | "bearer";
	/** Explicit evidence that the adapter derived a trustworthy subject. */
	readonly trustworthySubject: true;
}

/** Fail-closed delegated browser identity result. */
export type DelegatedBrowserIdentityDecision =
	| { readonly outcome: "trusted"; readonly identity: TrustedDelegatedBrowserIdentity }
	| { readonly outcome: "denied"; readonly reason: string };

/** OpenCrane-owned browser identity boundary. */
export interface DelegatedBrowserIdentityPort
{
	/** Resolves an authenticated cookie session without consulting bearer input. */
	resolveCookie(cookie: string): Promise<DelegatedBrowserIdentityDecision>;
	/** Resolves a bearer only when it yields a trustworthy issuer-bound subject. */
	resolveBearer(authorization: string): Promise<DelegatedBrowserIdentityDecision>;
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

/** Current canonical thread coordinates needed before action authorization. */
export interface ChannelThreadAuthority
{
	/** Canonical thread identifier. */
	readonly threadId: string;
	/** Silo that owns the thread. */
	readonly siloId: string;
	/** AgentService bound immutably to the thread. */
	readonly agentServiceId: string;
	/** Current thread lifecycle. */
	readonly state: "active" | "archived";
	/** Users explicitly participating in the thread. */
	readonly participantUserIds: readonly string[];
}

/** Exact authorization request after membership and thread binding. */
export interface AuthorizeChannelActionsCommand
{
	/** Verified human subject. */
	readonly subjectId: string;
	/** Host-selected silo. */
	readonly siloId: string;
	/** Canonical bound thread. */
	readonly threadId: string;
	/** AgentService bound to the thread. */
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

/** Request to the real interactive-run creation authority. */
export interface PrepareInteractiveRunCommand
{
	/** Verified delegated human subject. */
	readonly subjectId: string;
	/** Silo containing the run. */
	readonly siloId: string;
	/** Canonical thread receiving the user command. */
	readonly threadId: string;
	/** AgentService executed for the command. */
	readonly agentServiceId: string;
	/** Authorization evidence accepted for run creation. */
	readonly authorizationDigest: string;
}

/** Explicit outcome from the real run authority. */
export type PrepareInteractiveRunResult =
	| { readonly outcome: "ready"; readonly runId: string }
	| { readonly outcome: "denied" | "unavailable"; readonly reason: string };

/** Run creation port; no default or fake implementation is permitted. */
export interface ChannelRunStartPort
{
	/** Creates or resumes the real run and returns its durable identifier. */
	prepareInteractiveRun(command: PrepareInteractiveRunCommand): Promise<PrepareInteractiveRunResult>;
}

/** Atomic invocation-context issuance request. */
export interface IssueChannelInvocationContextCommand
{
	/** SHA-256 digest of the opaque context returned to channel-proxy. */
	readonly digest: string;
	/** Verified human subject and required thread participant. */
	readonly subjectId: string;
	/** Expected host-selected silo. */
	readonly siloId: string;
	/** Expected canonical thread. */
	readonly threadId: string;
	/** Expected thread-bound AgentService. */
	readonly agentServiceId: string;
	/** Exact channel operation being authorized. */
	readonly action: ChannelResolutionAction;
	/** Durable run created for a command, or null for event reads. */
	readonly runId: string | null;
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
}

/** Exact selected route returned only after atomic authority revalidation. */
export interface IssuedChannelInvocationContext
{
	/** Durable invocation-context row identifier. */
	readonly id: string;
	/** Controller-registered route identifier. */
	readonly routeId: string;
	/** Exact registered internal endpoint; never derived by the resolver. */
	readonly endpoint: string;
}

/** Atomic issuance outcome. */
export type IssueChannelInvocationContextResult =
	| { readonly status: "issued"; readonly context: IssuedChannelInvocationContext }
	| { readonly status: "thread_conflict" | "participant_conflict" | "run_conflict" | "route_unavailable" | "route_ambiguous" };

/** Online runtime-PEP consumption request. */
export interface ConsumeChannelInvocationContextCommand
{
	/** SHA-256 digest of the presented opaque context. */
	readonly digest: string;
	/** Route identifier registered to the receiving runtime. */
	readonly expectedRouteId: string;
	/** Trusted consumption instant. */
	readonly nowEpochMs: number;
}

/** Durable authority returned to the runtime PEP after one-time consumption. */
export interface ConsumedChannelInvocationContext
{
	/** Verified delegated human subject. */
	readonly subjectId: string;
	/** Bound silo. */
	readonly siloId: string;
	/** Bound thread. */
	readonly threadId: string;
	/** Bound AgentService. */
	readonly agentServiceId: string;
	/** Bound operation. */
	readonly action: ChannelResolutionAction;
	/** Durable run for commands, or null for event reads. */
	readonly runId: string | null;
	/** Authorization evidence digest. */
	readonly authorizationDigest: string;
}

/** One-time online consumption outcome. */
export type ConsumeChannelInvocationContextResult =
	| { readonly status: "consumed"; readonly context: ConsumedChannelInvocationContext }
	| { readonly status: "denied"; readonly reason: "not_found" | "route_mismatch" | "expired" | "revoked" | "replayed" | "route_inactive" | "run_inactive" };

/** Durable thread, route, and invocation-context authority. */
export interface ChannelTargetAuthorityRepository
{
	/** Loads current thread coordinates for pre-authorization checks. */
	getThreadAuthority(threadId: string): Promise<ChannelThreadAuthority | null>;
	/** Rechecks thread, participant, run, and selected route while inserting the digest. */
	issueInvocationContextAtomically(command: IssueChannelInvocationContextCommand): Promise<IssueChannelInvocationContextResult>;
	/** Consumes one digest once while rechecking the exact registered route online. */
	consumeInvocationContextAtomically(command: ConsumeChannelInvocationContextCommand): Promise<ConsumeChannelInvocationContextResult>;
}

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
	/** OpenCrane browser identity port. */
	readonly delegatedIdentity: DelegatedBrowserIdentityPort;
	/** Exact host registration port. */
	readonly hostSilo: TrustedHostSiloPort;
	/** Signed membership authority. */
	readonly membership: ChannelMembershipPort;
	/** Product action authorization facade. */
	readonly authorization: ChannelActionAuthorizationPort;
	/** Required real run-start authority. */
	readonly runStart: ChannelRunStartPort;
	/** Canonical thread, route, and context repository. */
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
	| { readonly outcome: "denied"; readonly reason: "invalid_request" | "workload_denied" | "identity_denied" | "host_denied" | "membership_denied" | "thread_denied" | "authorization_denied" | "run_denied" | "run_unavailable" | "route_denied" };
