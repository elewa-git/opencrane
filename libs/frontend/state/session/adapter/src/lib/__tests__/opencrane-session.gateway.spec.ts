import { Injector, runInInjectionContext } from "@angular/core";
import { describe, expect, it, vi } from "vitest";

import { ControlPlaneApiService, FleetManagerApiService } from "@opencrane/core";

import { OpenCraneSessionGateway } from "../opencrane-session.gateway";

/** Creates the live adapter around mocked generated clients for both API surfaces. */
function _Gateway(controlGet: ReturnType<typeof vi.fn>, controlPost: ReturnType<typeof vi.fn>, fleetGet: ReturnType<typeof vi.fn>, fleetPost: ReturnType<typeof vi.fn>): OpenCraneSessionGateway
{
	const controlPlane = { client: { GET: controlGet, POST: controlPost } } as unknown as ControlPlaneApiService;
	const fleetManager = { client: { GET: fleetGet, POST: fleetPost } } as unknown as FleetManagerApiService;
	const injector = Injector.create({ providers: [
		{ provide: ControlPlaneApiService, useValue: controlPlane },
		{ provide: FleetManagerApiService, useValue: fleetManager }
	] });
	return runInInjectionContext(injector, function _CreateGateway() { return new OpenCraneSessionGateway(); });
}

describe("OpenCraneSessionGateway", function _OpenCraneSessionGatewaySuite()
{
	it("loads organization identity from the Control Plane client", async function _LoadOrganizationSession()
	{
		const snapshot = { mode: "oidc", authenticated: true, user: { sub: "user-1", issuer: "https://identity.example", groups: ["org-admin"], isPlatformOperator: false, productCapabilities: { administerOrganization: true } } };
		const controlGet = vi.fn().mockResolvedValue({ data: snapshot });
		const fleetGet = vi.fn();
		const gateway = _Gateway(controlGet, vi.fn(), fleetGet, vi.fn());

		await expect(gateway.load("org")).resolves.toEqual({ authenticated: true, user: { sub: "user-1", groups: ["org-admin"], isPlatformOperator: false, productCapabilities: { administerOrganization: true } } });
		expect(controlGet).toHaveBeenCalledWith("/auth/me", {});
		expect(fleetGet).not.toHaveBeenCalled();
	});

	it("loads platform identity from the Fleet Manager client", async function _LoadPlatformSession()
	{
		const snapshot = { mode: "oidc", authenticated: true, user: { sub: "operator-1", issuer: "https://identity.example", groups: ["platform-operator"], isPlatformOperator: true, productCapabilities: { administerOrganization: false } } };
		const controlGet = vi.fn();
		const fleetGet = vi.fn().mockResolvedValue({ data: snapshot });
		const gateway = _Gateway(controlGet, vi.fn(), fleetGet, vi.fn());

		await expect(gateway.load("platform")).resolves.toEqual({ authenticated: true, user: { sub: "operator-1", groups: ["platform-operator"], isPlatformOperator: true, productCapabilities: { administerOrganization: false } } });
		expect(fleetGet).toHaveBeenCalledWith("/auth/me", {});
		expect(controlGet).not.toHaveBeenCalled();
	});

	it("preserves a generated session-read failure", async function _PreserveReadFailure()
	{
		const failure = { code: "unavailable" };
		const gateway = _Gateway(vi.fn().mockResolvedValue({ error: failure }), vi.fn(), vi.fn(), vi.fn());

		await expect(gateway.load("org")).rejects.toBe(failure);
	});

	it("logs out through the client that owns the selected surface", async function _LogoutSelectedSurface()
	{
		const controlPost = vi.fn().mockResolvedValue({ data: { endSessionUrl: null } });
		const fleetPost = vi.fn().mockResolvedValue({ data: { endSessionUrl: null } });
		const gateway = _Gateway(vi.fn(), controlPost, vi.fn(), fleetPost);

		await gateway.logout("org");
		await gateway.logout("platform");

		expect(controlPost).toHaveBeenCalledWith("/auth/logout");
		expect(fleetPost).toHaveBeenCalledWith("/auth/logout");
	});
});
