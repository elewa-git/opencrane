import type { ToolInvocationLifecycleEvent, ToolInvocationLifecycleEventSink } from "@opencrane/backend/server/iam/authorization";

/** Process transaction owner used both before dispatch and inside invocation transactions. */
export interface ToolInvocationLifecycleEventUnitOfWork extends ToolInvocationLifecycleEventSink
{
	/** Append one server-owned lifecycle event or fail before provider work can continue. */
	append(event: ToolInvocationLifecycleEvent): Promise<void>;
}

/** Transaction-bound repository for one validated tool lifecycle event. */
export interface ToolInvocationLifecycleEventAppendRepository
{
	/** Append only while the exact run attempt remains eligible for server tool work. */
	append(event: ToolInvocationLifecycleEvent): Promise<boolean>;
}

/** Transaction owner that constructs the lifecycle-event repository. */
export interface ToolInvocationLifecycleEventAppendUnitOfWork extends ToolInvocationLifecycleEventAppendRepository {}
