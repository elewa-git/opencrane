import type { ToolInvocationLifecycleEvent, ToolInvocationLifecycleEventSink } from "@opencrane/backend/server/iam/authorization";

/** Opens the transaction for writing a lifecycle event, both before dispatch and inside an invocation's own transaction. */
export interface ToolInvocationLifecycleEventUnitOfWork extends ToolInvocationLifecycleEventSink
{
	/** Appends the server-owned lifecycle event, or fails so no provider work continues. */
	append(event: ToolInvocationLifecycleEvent): Promise<void>;
}

/** Transaction-bound repository for one validated tool lifecycle event. */
export interface ToolInvocationLifecycleEventAppendRepository
{
	/** Appends only while the run is still on this attempt and still allowed to run server tool work. */
	append(event: ToolInvocationLifecycleEvent): Promise<boolean>;
}

/** Builds the lifecycle-event repository on the caller's transaction. */
export interface ToolInvocationLifecycleEventAppendUnitOfWork extends ToolInvocationLifecycleEventAppendRepository {}
