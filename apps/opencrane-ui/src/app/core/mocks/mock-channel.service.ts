import { Injectable, signal } from "@angular/core";

import { UiMockScenario } from "../models/mock-scenario.types.js";
import { UiChannel } from "../models/settings.types.js";
import { _DefaultChannels } from "./fixtures/settings.fixtures.js";

/** Owns deterministic channel connection state. */
@Injectable()
export class MockChannelService
{
	/** Mutable channel rows. */
	private readonly _channels = signal<readonly UiChannel[]>(_DefaultChannels());

	/** Read-only channel rows. */
	public readonly channels = this._channels.asReadonly();

	/** Adds or replaces one mock channel. */
	public save(value: UiChannel): void
	{
		this._channels.update(function _save(channels: readonly UiChannel[]): readonly UiChannel[]
		{
			return channels.some(function _matches(channel: UiChannel): boolean { return channel.id === value.id; })
				? channels.map(function _replace(channel: UiChannel): UiChannel { return channel.id === value.id ? { ...value } : channel; })
				: [...channels, { ...value }];
		});
	}

	/** Restores deterministic channel fixtures. */
	public reset(scenario: UiMockScenario = UiMockScenario.Default): void
	{
		this._channels.set(scenario === UiMockScenario.Empty ? [] : _DefaultChannels());
	}
}
