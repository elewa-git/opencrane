/**
 * Builds the advisory-lock key that serialises one silo's admission of one idempotency key.
 *
 * The key is a text parameter to `hashtextextended`, and PostgreSQL text cannot hold a NUL byte —
 * a value carrying one fails the whole statement with SQLSTATE 22021, so joining the two parts with
 * NUL made every admission fail. The silo's length prefixes the pair instead: distinct pairs stay
 * distinct keys without reserving a character either part might legitimately contain.
 *
 * Called by: PrismaRunAdmissionRepository.admit, PrismaChildRunReservationRepository (reservation).
 */
export function __AdmissionLockKey(siloId: string, requestIdempotencyKey: string): string
{
	return `${siloId.length}:${siloId}${requestIdempotencyKey}`;
}
