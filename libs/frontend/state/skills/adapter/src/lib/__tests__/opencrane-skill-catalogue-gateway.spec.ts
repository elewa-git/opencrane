import { Injector, runInInjectionContext } from "@angular/core";
import { describe, expect, it, vi } from "vitest";

import { ControlPlaneApiService } from "@opencrane/core";

import { OpenCraneSkillCatalogueGateway } from "../opencrane-skill-catalogue-gateway";

/** Builds the adapter with a deterministic Control Plane HTTP response. */
function _make(response: unknown): OpenCraneSkillCatalogueGateway
{
	const api = {
		client: {
			GET: vi.fn().mockResolvedValue(response)
		}
	} as unknown as ControlPlaneApiService;
	const injector = Injector.create({ providers: [{ provide: ControlPlaneApiService, useValue: api }] });

	return runInInjectionContext(injector, function _create(): OpenCraneSkillCatalogueGateway
	{
		return new OpenCraneSkillCatalogueGateway();
	});
}

describe("OpenCraneSkillCatalogueGateway", () =>
{
	it("returns only the generated safe catalogue response", async () =>
	{
		const gateway = _make({
			data: {
				skills: [{
					id: "skill-1",
					name: "Research brief",
					description: "Produces a source-grounded brief.",
					state: "active",
					currentRevisionId: "revision-1",
					currentRevisionState: "published",
					createdAt: "2026-07-26T08:00:00.000Z",
					updatedAt: "2026-07-26T08:00:00.000Z"
				}]
			},
			error: undefined
		});

		await expect(gateway.list()).resolves.toEqual([{
			id: "skill-1",
			name: "Research brief",
			description: "Produces a source-grounded brief.",
			state: "active",
			currentRevisionId: "revision-1",
			currentRevisionState: "published",
			createdAt: "2026-07-26T08:00:00.000Z",
			updatedAt: "2026-07-26T08:00:00.000Z"
		}]);
	});

	it("fails closed when the Control Plane omits data or returns an error", async () =>
	{
		await expect(_make({ data: undefined, error: undefined }).list()).rejects.toThrow("failed to list governed skills");
		await expect(_make({ data: undefined, error: { message: "denied" } }).list()).rejects.toThrow("failed to list governed skills");
	});
});
