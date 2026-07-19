# @opencrane/state/conversation/adapter — OpenClaw gateway protocol client

The live `ConversationGateway` implementation for the frozen blue OpenClaw runtime. Brokers a
pod via `POST /auth/pod-token` on the Control Plane (trusted-proxy auth: the browser holds no
token — the ingress authorises the socket against the OIDC session), then speaks the OpenClaw
gateway WebSocket protocol v4: TypeBox-validated frames, connect-challenge handshake, chat
history in a ≤1000-row window, and reconnect with backoff. Exports the protocol
schema/types, `OpenClawConnection`, `OpenClawConversationGateway`, and the pure history/
session-list/pod-token utils.

Broker failures map deterministically onto `ConnectionStatus`: `POD_NOT_READY` →
`Provisioning` (transient, retryable), `NO_TENANT`/`AMBIGUOUS_TENANT`/403 → `Refused`
(terminal), anything else backs off as `Closed`. All blue-runtime protocol knowledge is
confined here; features never import this lib — it is bound to `CONVERSATION_GATEWAY` by
`@opencrane/state/gateways`.

Tagged `scope:web`/`type:state`: may depend only on `scope:web` and `scope:shared` libs —
never on backend packages or apps.
