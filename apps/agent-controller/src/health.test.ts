import { afterEach, describe, expect, it } from "vitest";

import type { ControllerHealth } from "./health.types.js";
import { _CreateControllerHealth } from "./health.js";

/** Health listeners opened during a test and closed after the test. */
const _health: ControllerHealth[] = [];

afterEach(async function _shutdownHealth()
{
	await Promise.all(_health.splice(0).map(health => health.shutdown()));
});

/** Starts one isolated controller health listener on an ephemeral port. */
async function _Health(): Promise<ControllerHealth>
{
	const health = _CreateControllerHealth({ port: 0 });
	_health.push(health);
	await health.listen();
	return health;
}

/** Requests a single local probe endpoint. */
async function _Probe(health: ControllerHealth, path: string): Promise<Response>
{
	return fetch(`http://127.0.0.1:${health.port()}${path}`);
}

describe("controller health listener", function _describeHealth()
{
	it("starts unready while remaining live and returns bodyless responses", async function _startsUnready()
	{
		const health = await _Health();
		const readiness = await _Probe(health, "/readyz");
		const liveness = await _Probe(health, "/livez");

		expect(readiness.status).toBe(503);
		expect(liveness.status).toBe(204);
		expect(await liveness.text()).toBe("");
	});

	it("changes readiness without making liveness depend on external authority outcomes", async function _changesReadiness()
	{
		const health = await _Health();
		health.markReady();
		expect((await _Probe(health, "/readyz")).status).toBe(204);

		health.markUnready();
		expect((await _Probe(health, "/readyz")).status).toBe(503);
		expect((await _Probe(health, "/livez")).status).toBe(204);
	});
});
