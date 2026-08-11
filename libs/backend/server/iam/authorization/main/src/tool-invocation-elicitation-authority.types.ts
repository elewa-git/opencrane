import type { JsonValue } from "@opencrane/util";

import type { ToolInvocationClaim, ToolInvocationRecord } from "./tool-invocation.types.js";

/** Exact authenticated approval transition applied inside a caller-held transaction. */
export interface ApproveElicitedToolInvocationCommand
{
	/** Trusted database identity of the awaiting invocation. */
	readonly invocationId: string;
	/** Original canonical arguments protected by the approval fence. */
	readonly expectedArguments: JsonValue;
	/** Digest stored beside the original canonical arguments. */
	readonly expectedArgumentsDigest: string;
	/** Effective arguments admitted after approval. */
	readonly effectiveArguments: JsonValue;
	/** Digest stored beside the effective arguments. */
	readonly effectiveArgumentsDigest: string;
}

/** Exact authenticated rejection transition applied inside a caller-held transaction. */
export interface RejectElicitedToolInvocationCommand
{
	/** Trusted database identity of the awaiting invocation. */
	readonly invocationId: string;
	/** Server-controlled decision or expiry instant. */
	readonly now: Date;
	/** Bounded public-safe failure classification. */
	readonly failureCode: string;
}

/** Authorization-owned invocation port bound to one elicitation transaction. */
export interface ToolInvocationElicitationRepository
{
	/** Load one exact invocation without leaking generated persistence types. */
	findById(invocationId: string): Promise<ToolInvocationRecord | null>;
	/** Advance one exact awaiting invocation to Ready. */
	approve(command: ApproveElicitedToolInvocationCommand): Promise<boolean>;
	/** Terminalise one exact rejected or expired invocation and create its safe delivery. */
	reject(command: RejectElicitedToolInvocationCommand): Promise<boolean>;
	/** Recheck one exact, unexpired, single-row dispatch claim before protected work. */
	verifyActiveDispatchClaim(invocation: ToolInvocationRecord, claim: ToolInvocationClaim, now: Date): Promise<boolean>;
}
