import type { Logger } from "@opencrane/backend/observability";

import type { ConversationCallerResolver } from "../../messages/self-conversation-history.types";
import type { PersonalMemoryCommandAuthority } from "./personal-memory-command-authority.types";

/** Dependencies required by the authenticated personal-memory command HTTP boundary. */
export interface PersonalMemoryCommandRouterDependencies
{
	/** Applies current personal-memory scope and operation authorization. */
	readonly authority: PersonalMemoryCommandAuthority;
	/** Resolves the caller from server-authenticated request state. */
	readonly resolveCaller: ConversationCallerResolver;
	/** Records bounded diagnostics for unexpected authority failures. */
	readonly logger: Pick<Logger, "warn">;
}
