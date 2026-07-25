/** Fixed, server-owned limits for recursive runtime child-run requests. */
export interface RuntimeChildRunSpawnPolicy
{
	/** Maximum number of parent-to-child edges allowed below a root run. */
	readonly maximumDepth: number;
	/** Maximum direct children a single parent run may reserve. */
	readonly maximumChildrenPerParent: number;
}
