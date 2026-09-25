import { computed, inject, linkedSignal, resource } from "@angular/core";

import { GovernanceReadError, GovernanceReadErrorKinds } from "@opencrane/state/governance";

import { GovernanceReadContextStore } from "./governance-read-context.store";
import type { GovernanceReadRequest } from "./governance-read-context.types";
import { GovernanceReadStates, type GovernanceReadFeedback } from "./reporting-view.types";

/**
 * Owns read admission, retained results and error states for one independently protected endpoint.
 * Routes never adopt HTTP results. Changing the reader clears both retained data and errors;
 * explicit access denial also clears data, while a temporary outage labels retained data as stale.
 */
export class GovernanceSnapshotStore<TValue, TQuery = undefined>
{
	/** Route-local identity and authentication-loss boundary. */
	private readonly _context = inject(GovernanceReadContextStore);
	/** Records explicit retries separately from the endpoint query. */
	private readonly _request;
	/** Retains a result only until the reader identity changes. */
	private readonly _retained = linkedSignal({ source: this._context.scope, computation: function _Empty(): TValue | null { return null; } });
	/** Keeps the latest endpoint error, never a raw server diagnostic. */
	private readonly _failure = linkedSignal({ source: this._context.scope, computation: function _Empty(): GovernanceReadErrorKinds | null { return null; } });
	/** Closes duplicate admission before Angular starts the next resource load. */
	private readonly _pending = linkedSignal({ source: this._context.scope, computation: function _Idle() { return false; } });
	/** Owns cancellation and latest-request adoption for asynchronous reads. */
	private readonly _resource;
	/** Shows the last permitted projection, including explicitly stale data after a read outage. */
	public readonly value = this._retained.asReadonly();
	/** Includes immediately admitted requests and active resource work. */
	public readonly busy;
	/** Presents only safe local messages and finite read states. */
	public readonly feedback;

	/** Creates an endpoint reader; the caller supplies its query and any endpoint-specific merging. */
	public constructor(private readonly _read: (query: TQuery, signal: AbortSignal, previous: TValue | null) => Promise<TValue>, initialQuery: TQuery)
	{
		this._request = linkedSignal({ source: this._context.scope, computation: function _InitialRequest(): GovernanceReadRequest<TQuery> { return { generation: 0, query: initialQuery }; } });
		const context = this._context;
		const request = this._request;
		const owner = this;
		this._resource = resource({
			params: function _Params()
			{
				const scope = context.scope();
				return { scope, request: request() };
			},
			loader: async function _Load({ params, abortSignal })
			{
				// A changed request lets the resource abort the previous load even after sign-out.
				// An undefined resource request would skip that cancellation in this Angular version.
				if (params.scope.identity === null)
					return null;
				owner._failure.set(null);
				try
				{
					const result = await owner._read(params.request.query, abortSignal, owner._retained());
					if (!abortSignal.aborted && context.scope() === params.scope && request() === params.request)
						owner._retained.set(result);
				}
				catch (error)
				{
					if (abortSignal.aborted || context.scope() !== params.scope || request() !== params.request)
						return null;
					const kind = error instanceof GovernanceReadError ? error.kind : GovernanceReadErrorKinds.Unavailable;
					owner._failure.set(kind);
					if (kind === GovernanceReadErrorKinds.AccessDenied || kind === GovernanceReadErrorKinds.Unauthenticated)
						owner._retained.set(null);
					if (kind === GovernanceReadErrorKinds.Unauthenticated)
						context.loseAuthentication(params.scope);
				}
				finally
				{
					if (request() === params.request)
						owner._pending.set(false);
				}
				return null;
			},
			defaultValue: null
		});
		this.busy = computed(() => this._pending() || this._resource.isLoading());
		this.feedback = computed(this._Feedback.bind(this));
	}

	/** Admits one read; retries cannot overlap or reuse a result from a different reader. */
	public refresh(query: TQuery): boolean
	{
		if (this.busy())
			return false;
		this._context.recheck();
		if (this._context.scope().identity === null)
			return false;
		this._pending.set(true);
		this._failure.set(null);
		this._request.update(previous => ({ generation: previous.generation + 1, query }));
		return true;
	}

	/** Gives authentication and endpoint denial precedence over retained private data. */
	private _Feedback(): GovernanceReadFeedback
	{
		if (this._context.scope().identity === null)
			return { state: GovernanceReadStates.Unauthenticated, error: "Sign in again to read these records." };
		if (this._failure() === GovernanceReadErrorKinds.AccessDenied)
			return { state: GovernanceReadStates.Forbidden, error: "You do not currently have permission to read these records." };
		if (this.busy())
			return { state: this.value() === null ? GovernanceReadStates.Loading : GovernanceReadStates.Refreshing, error: null };
		if (this._failure() !== null)
		{
			const retained = this.value() !== null;
			const state = retained ? GovernanceReadStates.RetainedError : GovernanceReadStates.Unavailable;
			const error = retained ? "The latest read failed. The records below may be out of date." : "These records could not be loaded. Please retry.";
			return { state, error };
		}
		return { state: GovernanceReadStates.Ready, error: null };
	}
}
