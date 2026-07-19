# backend-server-channel-targets — channel target resolution authority

Owns the server-side decision of where a delegated browser operation may go. For each request the
channel proxy forwards, `__ResolveChannelTarget` runs the full trust chain in order and fails
closed at every step: TokenReview of the proxy's projected workload token (exact audience, KSA,
namespace, and username), delegated user identity (cookie resolved before bearer, with no
cross-mechanism fallback), the origin-checked host bound to one registered silo, current signed
fleet membership, active-thread participation, and the complete authorized action set. Commands
additionally require a durable interactive run from the `ChannelRunStartPort` before any route is
issued.

The output is one exact runtime endpoint plus a short-lived opaque invocation context: 256 random
bits whose digest — never the value — is persisted atomically with every binding
(`PrismaChannelTargetAuthorityRepository`), with expiry clipped to the membership trust window and
endpoints restricted to configured host suffixes. `__CreateChannelTargetsRouter` is the internal
workload-authenticated Express surface; it rejects forged identity headers and accepts no
self-asserted subject or silo fields. The public edge (`libs/backend/channel-proxy`) calls this
authority over `/api/internal/channel-targets:resolve` and holds no policy of its own.

Tagged `scope:channel-targets` (no scope-level depConstraint is registered yet in
`eslint.config.mjs`); the `layer:backend` and `type:lib` rules still forbid importing entrypoint
or frontend layers and apps. It imports only the authorization models and shared utilities.

See [`../../README.md`](../../README.md) for the control-plane capability map.
