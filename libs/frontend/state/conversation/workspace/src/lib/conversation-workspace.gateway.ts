import { InjectionToken } from "@angular/core";

import type { ConversationEventStream } from "@opencrane/state/conversation/adapter";

import type { ConversationWorkspaceGateway } from "./conversation-workspace.types.js";

/** Injection port for participant-scoped workspace reads and commands. */
export const CONVERSATION_WORKSPACE_GATEWAY = new InjectionToken<ConversationWorkspaceGateway>("CONVERSATION_WORKSPACE_GATEWAY");

/** Injection port for the shared conversation projection stream. */
export const CONVERSATION_WORKSPACE_EVENT_STREAM = new InjectionToken<ConversationEventStream>("CONVERSATION_WORKSPACE_EVENT_STREAM");
