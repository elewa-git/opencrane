/** Saved run coordinates needed to bind an approval without depending on a database model. */
export interface ApprovalRunBinding
{
	/** Run identity. */
	readonly id: string;
	/** Organisation owning the run. */
	readonly siloId: string;
	/** Conversation in which the requester participates. */
	readonly conversationId: string | null;
	/** Admitted attempt. */
	readonly attempt: number;
	/** Assistant service executing the action. */
	readonly agentServiceId: string;
	/** Frozen assistant revision. */
	readonly agentRevisionId: string | null;
	/** Assistant identity bound by admission. */
	readonly agentIdentityId: string | null;
	/** Execution principal, separate from a company assistant's human requester. */
	readonly principalId: string;
	/** Untrusted saved subject to validate against the invocation. */
	readonly executionSubject: unknown;
}

/** Protected approval coordinates that must agree with the linked participant request. */
export interface ApprovalRequestBinding
{
	/** Protected approval identity. */
	readonly id: string;
	/** Saved participant request identity. */
	readonly elicitationRequestId: string | null;
	/** Organisation owning the action. */
	readonly siloId: string;
	/** Owning run. */
	readonly runId: string;
	/** Owning attempt. */
	readonly attempt: number;
	/** Immutable action digest used as the request key. */
	readonly actionDigest: string;
	/** Last instant at which a decision can be accepted. */
	readonly expiresAt: Date;
}

/** Participant request fields whose binding is checked independently of persistence enums. */
export interface ApprovalElicitationBinding
{
	/** Participant request identity. */
	readonly id: string;
	/** Organisation owning the request. */
	readonly siloId: string;
	/** Conversation displaying the request. */
	readonly conversationId: string;
	/** Owning run. */
	readonly runId: string;
	/** Owning attempt. */
	readonly attempt: number;
	/** Original human requester's authenticated subject. */
	readonly assignedParticipantId: string;
	/** Immutable action digest. */
	readonly requestKey: string;
	/** Whether the response must carry fresh authentication. */
	readonly requiresStepUp: boolean;
	/** Same decision deadline as the protected approval. */
	readonly expiresAt: Date;
	/** Untrusted saved purpose payload, compared with the expected approval identity. */
	readonly purposePayload: unknown;
	/** Digest of that immutable purpose payload. */
	readonly purposePayloadDigest: string;
}
