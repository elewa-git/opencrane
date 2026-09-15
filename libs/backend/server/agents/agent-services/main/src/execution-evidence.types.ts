/**
 * Names the transient result states returned by personal and managed execution-evidence authorities.
 *
 * Authority callers branch on these process-local values before assembling an execution subject.
 * The values are not persisted or sent through an external API, and callers must reject unknown
 * values instead of treating them as loaded evidence.
 */
export enum ExecutionEvidenceOutcomes
{
	/** The authority proved current identity, membership, revision, and product authorization evidence. */
	Loaded = "loaded",
	/** The authority refused to issue evidence and returned its fail-closed reason. */
	Denied = "denied",
}
