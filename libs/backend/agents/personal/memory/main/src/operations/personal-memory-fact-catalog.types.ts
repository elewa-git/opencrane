/**
 * Sensitivity classifications persisted for direct personal-memory commands.
 *
 * The server selects this value instead of accepting a caller classification. The stored string
 * is immutable catalog metadata; changing it requires a reviewed policy for already-admitted
 * operations. The label never grants access.
 */
export enum PersonalMemoryFactSensitivities
{
	/** Marks a fact as personal while conferring no permission to read or mutate it. */
	Personal = "personal",
}
