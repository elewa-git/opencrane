/** Public conversation projection engine and framework-neutral ports. */
export { __DecodeConversationProjectionCursor, __EncodeConversationProjectionCursor } from "./conversation-projection-cursor";
export { __StreamConversationProjection, CONVERSATION_PROJECTION_CLOCK, CONVERSATION_PROJECTION_LIMITS } from "./conversation-projection-stream";
export type { ConversationProjectionEventRow } from "./conversation-event-projector.types";
export type { ConversationProjectionReader, ConversationProjectionReadResult, ReadConversationProjectionCommand } from "./conversation-projection-reader.types";
export { ConversationProjectionReadStatuses } from "./conversation-projection-reader.types";
export type { ConversationOpenInterruptReader, ConversationProjectionClock, ConversationProjectionDependencies, ConversationProjectionLimits, ConversationProjectionSink, ReadOpenConversationInterruptsCommand, StreamConversationProjectionCommand } from "./conversation-projection-stream.types";
export { ConversationProjectionOutcomes } from "./conversation-projection-stream.types";
