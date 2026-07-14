import { Injectable, signal } from "@angular/core";

import { UiMockScenario } from "../models/mock-scenario.types.js";
import { UiDataset } from "../models/settings.types.js";
import { _DefaultDatasets } from "./fixtures/settings.fixtures.js";

/** Owns deterministic dataset and egress presentation state. */
@Injectable()
export class MockDataNetworkService
{
	/** Mutable dataset rows. */
	private readonly _datasets = signal<readonly UiDataset[]>(_DefaultDatasets());

	/** Mutable egress-domain rows. */
	private readonly _egressDomains = signal<readonly string[]>(["api.anthropic.com", "api.openai.com"]);

	/** Read-only dataset rows. */
	public readonly datasets = this._datasets.asReadonly();

	/** Read-only egress-domain rows. */
	public readonly egressDomains = this._egressDomains.asReadonly();

	/** Adds one normalized mock egress domain. */
	public addDomain(domain: string): void
	{
		const normalized = domain.trim().toLowerCase();
		if (normalized && !this._egressDomains().includes(normalized))
		{
			this._egressDomains.update(function _append(domains: readonly string[]): readonly string[] { return [...domains, normalized]; });
		}
	}

	/** Restores deterministic data and network fixtures. */
	public reset(scenario: UiMockScenario = UiMockScenario.Default): void
	{
		const empty = scenario === UiMockScenario.Empty;
		this._datasets.set(empty ? [] : _DefaultDatasets());
		this._egressDomains.set(empty ? [] : ["api.anthropic.com", "api.openai.com"]);
	}
}
