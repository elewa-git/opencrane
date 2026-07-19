/** Immutable controller-approved coordinates used to project one inert runtime Job. */
export interface RuntimeJobTemplateInput
{
	/** Deterministic Kubernetes Job name. */
	readonly name: string;
	/** Immutable labels binding the Job to one run attempt. */
	readonly labels: Readonly<Record<string, string>>;
	/** Exact zero-RBAC runtime service account. */
	readonly serviceAccountName: string;
	/** Exact immutable runtime image. */
	readonly image: string;
	/** Projected runtime-token TTL in seconds. */
	readonly projectedTokenTtlSeconds: number;
}
