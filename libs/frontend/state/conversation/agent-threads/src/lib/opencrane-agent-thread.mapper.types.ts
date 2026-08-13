import type { paths } from "@opencrane/contracts";

/** Generated success DTO for one exact authorized Agent-thread route. */
export type AgentThreadSnapshotDto = paths["/me/conversations/{parentConversationId}/agent-threads/{childConversationId}"]["get"]["responses"][200]["content"]["application/json"]["agentThread"];
