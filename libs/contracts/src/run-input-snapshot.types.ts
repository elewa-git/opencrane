import type { AgentRevisionId, AgentRunId, AgentServiceId, ExecutionSubject, PersonaRevisionId } from "@opencrane/models/agents";
import type { ArtifactRevisionId, SkillRevisionId } from "@opencrane/models/artifacts";
import type { ConversationId, MessageId } from "@opencrane/models/conversations";
import type { JsonValue } from "@opencrane/util";

/** One exact MCP tool revision frozen when a run is admitted. */
export interface RunInputSnapshotMcpTool
{
  /** Immutable McpToolRevision primary key selected by the AgentRevision. */
  toolRevisionId: string;
  /** Stable MCP tool name discovered with the selected server revision. */
  name: string;
  /** Human-readable model guidance discovered with the selected server revision. */
  description: string | null;
  /** Exact JSON Schema used for model input and approval validation. */
  inputSchema: JsonValue;
  /** Digest of the input schema, so it cannot change after admission. */
  inputSchemaDigest: string;
}

/** Everything a run needs, compiled and frozen before the runtime is assigned. */
export interface RunInputSnapshot
{
  /** Run receiving the snapshot. */
  runId: AgentRunId;
  /** Positive attempt receiving this immutable snapshot. */
  attempt: number;
  /** Silo in which every identity and durable input is valid. */
  siloId: string;
  /** AgentService receiving the run. */
  agentServiceId: AgentServiceId;
  /** Immutable AgentRevision being executed. */
  agentRevisionId: AgentRevisionId;
  /** Monotonically versioned snapshot contract shape. */
  snapshotVersion: number;
  /** Conversation supplying ordered history, or null for a non-conversational run. */
  conversationId: ConversationId | null;
  /** Ordered persisted messages included in the prompt. */
  messageIds: readonly MessageId[];
  /** Approved persona revision compiled into the prompt, when personal. */
  personaRevisionId: PersonaRevisionId | null;
  /** Ordered durable preference facts considered for this run. */
  preferenceFactIds: readonly string[];
  /** Immutable artifact revisions made available to the run. */
  artifactRevisionIds: readonly ArtifactRevisionId[];
  /** Immutable skill revisions made available to the run. */
  skillRevisionIds: readonly SkillRevisionId[];
  /** Authorised memory retrieval policy selected for this run. */
  memoryQueryPolicy: JsonValue;
  /** Exact immutable MCP tool revisions selected by the AgentRevision. */
  mcpTools: readonly RunInputSnapshotMcpTool[];
  /** Server-selected model route without provider credentials. */
  modelRoute: JsonValue;
  /** Immutable token, cost, time, and tool limits. */
  budgetPolicy: JsonValue;
	/** Exact evidence-bound identity and principal that may exercise this run. */
  executionSubject: ExecutionSubject;
	/** Version of the deterministic prompt compiler that will consume this input. */
  promptCompilerVersion: string;
  /** SHA-256 digest of the complete canonical snapshot in `sha256:<hex>` form. */
  digest: string;
  /** ISO-8601 compilation time. */
  compiledAt: string;
}
