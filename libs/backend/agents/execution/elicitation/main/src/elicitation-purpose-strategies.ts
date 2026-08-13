import { ElicitationPurposes, type ElicitationResponseValue } from "@opencrane/contracts";

import type { ElicitationPurposeRequest, ElicitationPurposeStrategy, ElicitationPurposeStrategyDependencies, ElicitationPurposeStrategyRegistry } from "./elicitation-purpose-strategy.types.js";

/** Ordinary runtime-input consequence. */
class _RuntimeInputPurposeStrategy implements ElicitationPurposeStrategy
{
	/** Transaction-bound operations retained by the single Prisma repository. */
	private readonly dependencies: ElicitationPurposeStrategyDependencies;

	/** Bind the explicit runtime-input consequence. */
	constructor(dependencies: ElicitationPurposeStrategyDependencies)
	{
		this.dependencies = dependencies;
	}

	/** Persist only ordinary runtime input as a response delivery. */
	apply(request: ElicitationPurposeRequest, response: ElicitationResponseValue, _subjectId: string, _now: Date): Promise<boolean>
	{
		return this.dependencies.applyRuntimeInput(request, response);
	}

	/** Publish an empty terminal delivery when ordinary input expires. */
	expire(request: ElicitationPurposeRequest, _now: Date): Promise<void>
	{
		return this.dependencies.expireRuntimeDelivery(request);
	}
}

/** Protected deferred-tool approval consequence. */
class _ToolApprovalPurposeStrategy implements ElicitationPurposeStrategy
{
	/** Transaction-bound operations retained by the single Prisma repository. */
	private readonly dependencies: ElicitationPurposeStrategyDependencies;

	/** Bind the explicit tool-approval consequence. */
	constructor(dependencies: ElicitationPurposeStrategyDependencies)
	{
		this.dependencies = dependencies;
	}

	/** Delegate the attributed answer to authorization authority. */
	apply(request: ElicitationPurposeRequest, response: ElicitationResponseValue, subjectId: string, now: Date): Promise<boolean>
	{
		return this.dependencies.applyToolApproval(request, response, subjectId, now);
	}

	/** Expire only the exact deferred tool authority. */
	expire(request: ElicitationPurposeRequest, now: Date): Promise<void>
	{
		return this.dependencies.expireToolApproval(request, now);
	}
}

/** Protected one-use personal-memory permission consequence. */
class _PersonalMemoryPermissionPurposeStrategy implements ElicitationPurposeStrategy
{
	/** Transaction-bound operations retained by the single Prisma repository. */
	private readonly dependencies: ElicitationPurposeStrategyDependencies;

	/** Bind the explicit personal-memory consequence. */
	constructor(dependencies: ElicitationPurposeStrategyDependencies)
	{
		this.dependencies = dependencies;
	}

	/** Mint or reject only the exact content-free permission receipt. */
	apply(request: ElicitationPurposeRequest, response: ElicitationResponseValue, subjectId: string, now: Date): Promise<boolean>
	{
		return this.dependencies.applyPersonalMemoryPermission(request, response, subjectId, now);
	}

	/** Expire only the invocation named by the protected payload. */
	expire(request: ElicitationPurposeRequest, now: Date): Promise<void>
	{
		return this.dependencies.expirePersonalMemoryPermission(request, now);
	}
}

/** Display-bound A2UI consequence. */
class _A2uiActionPurposeStrategy implements ElicitationPurposeStrategy
{
	/** Transaction-bound operations retained by the single Prisma repository. */
	private readonly dependencies: ElicitationPurposeStrategyDependencies;

	/** Bind the explicit A2UI consequence. */
	constructor(dependencies: ElicitationPurposeStrategyDependencies)
	{
		this.dependencies = dependencies;
	}

	/** Persist only the server-bound displayed-action envelope. */
	apply(request: ElicitationPurposeRequest, response: ElicitationResponseValue, _subjectId: string, _now: Date): Promise<boolean>
	{
		return this.dependencies.applyA2uiAction(request, response);
	}

	/** Publish an empty terminal delivery when the displayed action expires. */
	expire(request: ElicitationPurposeRequest, _now: Date): Promise<void>
	{
		return this.dependencies.expireRuntimeDelivery(request);
	}
}

/** Exhaustive public-purpose registry over transaction-bound repository operations. */
export class _ElicitationPurposeStrategies implements ElicitationPurposeStrategyRegistry
{
	/** One explicit strategy for every durable purpose exposed through the public contract. */
	private readonly strategies: Readonly<Record<ElicitationPurposes, ElicitationPurposeStrategy>>;

	/** Construct every strategy over the same transaction-bound operations. */
	constructor(dependencies: ElicitationPurposeStrategyDependencies)
	{
		this.strategies = {
			[ElicitationPurposes.RuntimeInput]: new _RuntimeInputPurposeStrategy(dependencies),
			[ElicitationPurposes.ToolApproval]: new _ToolApprovalPurposeStrategy(dependencies),
			[ElicitationPurposes.PersonalMemoryPermission]: new _PersonalMemoryPermissionPurposeStrategy(dependencies),
			[ElicitationPurposes.A2uiAction]: new _A2uiActionPurposeStrategy(dependencies),
		};
	}

	/** Select a declared purpose; an unknown durable value cannot fall back to runtime delivery. */
	forPurpose(purpose: ElicitationPurposes): ElicitationPurposeStrategy
	{
		const strategy = this.strategies[purpose];
		if (strategy === undefined) throw new Error(`unsupported elicitation purpose: ${purpose}`);
		return strategy;
	}
}
