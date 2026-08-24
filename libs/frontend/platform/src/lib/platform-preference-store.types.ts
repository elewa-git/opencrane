/**
 * Stores small runtime preferences without exposing browser globals to feature or state packages.
 *
 * The active application shell supplies the implementation. Callers must treat a failed write or
 * missing value as unavailable preference state, never as product authority.
 */
export interface PlatformPreferenceStore
{
	/** Read one preference, or return null when it is absent or storage is unavailable. */
	read(key: string): string | null;
	/** Save one preference and report whether the runtime accepted it. */
	write(key: string, value: string): boolean;
	/** Remove one preference when the runtime permits it. */
	remove(key: string): void;
}
