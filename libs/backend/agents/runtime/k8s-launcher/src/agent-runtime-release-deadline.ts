/** Safety margin ensuring whole-second Kubernetes deadline rounding cannot extend authority. */
const _RELEASE_DEADLINE_SAFETY_SECONDS = 1;

/**
 * Derive the conservative Kubernetes deadline for releasing one durable assignment.
 *
 * Kubernetes accepts only whole seconds. The result therefore rounds down, subtracts one further
 * safety second, and never exceeds the deployment-owned profile maximum. An expired or nearly
 * expired assignment fails before the controller can make the Job executable.
 * @param assignmentExpiresAt - Canonical UTC assignment expiry issued by Postgres authority.
 * @param nowEpochMilliseconds - Current controller wall-clock instant in epoch milliseconds.
 * @param profileMaximumSeconds - Maximum active lifetime permitted by the immutable profile.
 * @returns Positive whole seconds safe to patch into the assigned Job before release.
 */
export function __DeriveAgentRuntimeReleaseDeadlineSeconds(assignmentExpiresAt: string, nowEpochMilliseconds: number, profileMaximumSeconds: number): number
{
	const expiresAtEpochMilliseconds = Date.parse(assignmentExpiresAt);
	if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(assignmentExpiresAt)
		|| !Number.isSafeInteger(expiresAtEpochMilliseconds)
		|| new Date(expiresAtEpochMilliseconds).toISOString() !== assignmentExpiresAt
		|| !Number.isSafeInteger(nowEpochMilliseconds)
		|| nowEpochMilliseconds < 0
		|| !Number.isSafeInteger(profileMaximumSeconds)
		|| profileMaximumSeconds < 1)
	{
		throw new Error("agent runtime release requires canonical expiry, current time, and profile deadline");
	}
	const remainingWholeSeconds = Math.floor((expiresAtEpochMilliseconds - nowEpochMilliseconds) / 1_000) - _RELEASE_DEADLINE_SAFETY_SECONDS;
	if (remainingWholeSeconds <= 0)
	{
		throw new Error("agent runtime assignment expires before a safe Job release deadline");
	}
	return Math.min(profileMaximumSeconds, remainingWholeSeconds);
}
