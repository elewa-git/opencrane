export { HistoryExpectedRevisions } from "./history-store.types";
export type { HistoryAppend, HistoryAppendReceipt, HistoryAtomicAppend, HistoryEvent, HistoryExpectedHead, HistoryPersistentRecordedEvent, HistoryPersistentSubscription, HistoryPersistentSubscriptionRequest, HistoryReadRequest, HistoryRecordedEvent, HistoryStore, HistoryStreamHead, HistorySubscription } from "./history-store.types";
export { _KurrentHistoryStore } from "./kurrent-history-store";
export { _CreateHistoryStoreComposition } from "./connection/history-store-composition";
export { _AssertHistoryStoreSilo, _SILO_SENTINEL_STREAM } from "./connection/history-store-silo-guard";
export type { OpenCraneHistoryStoreComposition } from "./connection/history-store-composition.types";
export type { OpenCraneHistoryStoreConfig } from "./connection/history-store-config.types";
