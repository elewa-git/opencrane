import { Injector, runInInjectionContext } from "@angular/core";
import { describe, expect, it, vi } from "vitest";

import { ControlPlaneApiService } from "@opencrane/core";

import { OpenCranePersonalAssetsGateway } from "../opencrane-personal-assets-gateway";

/** Builds the adapter with a deterministic Control Plane HTTP response. */
function _make(response: unknown): OpenCranePersonalAssetsGateway
{
	const api = {
		client: {
			GET: vi.fn().mockResolvedValue(response)
		}
	} as unknown as ControlPlaneApiService;
	const injector = Injector.create({ providers: [{ provide: ControlPlaneApiService, useValue: api }] });

	return runInInjectionContext(injector, function _create(): OpenCranePersonalAssetsGateway
	{
		return new OpenCranePersonalAssetsGateway();
	});
}

describe("OpenCranePersonalAssetsGateway", () =>
{
	it("returns only the generated owner-bound catalogue response", async () =>
	{
		const gateway = _make({
			data: {
				assets: [{
					id: "asset-1",
					kind: "document",
					state: "active",
					currentRevisionId: "revision-1",
					mediaType: "text/plain",
					byteLength: "12",
					indexState: "indexed",
					createdAt: "2026-07-26T08:00:00.000Z",
					updatedAt: "2026-07-26T08:00:00.000Z"
				}]
			},
			error: undefined
		});

		await expect(gateway.list()).resolves.toEqual([{
			id: "asset-1",
			kind: "document",
			state: "active",
			currentRevisionId: "revision-1",
			mediaType: "text/plain",
			byteLength: "12",
			indexState: "indexed",
			createdAt: "2026-07-26T08:00:00.000Z",
			updatedAt: "2026-07-26T08:00:00.000Z"
		}]);
	});

	it("fails closed when the Control Plane omits data or returns an error", async () =>
	{
		await expect(_make({ data: undefined, error: undefined }).list()).rejects.toThrow("failed to list personal assets");
		await expect(_make({ data: undefined, error: { message: "denied" } }).list()).rejects.toThrow("failed to list personal assets");
	});
});
