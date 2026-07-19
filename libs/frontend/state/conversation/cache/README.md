# @opencrane/state/conversation/cache — IndexedDB conversation snapshot cache

Owns `IndexedDbConversationCache`, the web implementation of the `ConversationCache` port from
`@opencrane/state/core`. Stores each thread's most-recent window as a single `CachedThread`
record keyed by `threadId`, plus per-tenant `CachedSessions` lists, so reopening a thread
paints instantly while the live gateway reconnects and re-fetches.

Best-effort by design: the cache is only ever an optimisation, never a source of truth. Where
IndexedDB is unavailable (SSR, locked-down browser) every method degrades to a no-op instead
of throwing.

Provided by `apps/opencrane-ui`, which binds it to the `CONVERSATION_CACHE` token the
conversation gateway reads. Tagged `scope:web`/`type:state`: may depend only on `scope:web`
and `scope:shared` libs — never on backend packages or apps.
