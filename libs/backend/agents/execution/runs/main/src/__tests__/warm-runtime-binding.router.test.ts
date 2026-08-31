import { createHash, generateKeyPairSync, type JsonWebKey } from "node:crypto";

import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";

import type { Es256PublicJwk } from "@opencrane/models/authorization";

import { __CreateWarmRuntimeBindingRouter } from "../warm-runtime-binding.router";
import type { WarmRuntimeBindingRouterDependencies } from "../warm-runtime-binding.types";

/** Generate valid public proof evidence for the boundary under test. */
function _Proof(): { readonly proofPublicJwk: Es256PublicJwk; readonly proofKeyThumbprint: string }
{
	const exported = generateKeyPairSync("ec", { namedCurve: "P-256" }).publicKey.export({ format: "jwk" }) as JsonWebKey;
	const proofPublicJwk: Es256PublicJwk = { kty: "EC", crv: "P-256", x: exported.x ?? "", y: exported.y ?? "" };
	const canonical = JSON.stringify({ crv: proofPublicJwk.crv, kty: proofPublicJwk.kty, x: proofPublicJwk.x, y: proofPublicJwk.y });
	return { proofPublicJwk, proofKeyThumbprint: createHash("sha256").update(canonical, "utf8").digest("base64url") };
}

/** Build the route dependencies with one reviewed warm Pod. */
function _Dependencies(): WarmRuntimeBindingRouterDependencies
{
	return {
		tokenReviewer: { __Review: vi.fn(async function _Review() { return { subject: "system:serviceaccount:runtime:warm-runtime", namespace: "runtime", serviceAccountName: "warm-runtime", podUid: "pod-1" }; }) },
		authority: { bind: vi.fn(async function _Bind() { return { outcome: "bound" as const, receiptId: "receipt-1", attemptModelKey: "secret-attempt-key" }; }) },
		logger: { error: vi.fn() },
	};
}

/** Mount the internal router with the production JSON parser. */
function _App(dependencies: WarmRuntimeBindingRouterDependencies): express.Express
{
	const app = express();
	app.use(express.json());
	app.use(__CreateWarmRuntimeBindingRouter(dependencies));
	return app;
}

describe("warm runtime binding router", function _Suite()
{
	it("returns the attempt key only after the reviewed Pod binds its proof key", async function _Binds()
	{
		const dependencies = _Dependencies();
		const proof = _Proof();
		const response = await request(_App(dependencies)).post("/bind").set("authorization", "Bearer projected-token").send(proof);

		expect(response.status).toBe(200);
		expect(response.body).toEqual({ receiptId: "receipt-1", attemptModelKey: "secret-attempt-key" });
		expect(dependencies.authority.bind).toHaveBeenCalledWith(expect.objectContaining({ podUid: "pod-1" }), proof);
	});

	it("rejects an unreviewed Pod before it reads binding evidence", async function _RejectsIdentity()
	{
		const dependencies = _Dependencies();
		(dependencies.tokenReviewer.__Review as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);
		const response = await request(_App(dependencies)).post("/bind").set("authorization", "Bearer rejected").send(_Proof());

		expect(response.status).toBe(401);
		expect(dependencies.authority.bind).not.toHaveBeenCalled();
	});

	it("reports one-use proof conflicts without returning a model key", async function _RejectsConflict()
	{
		const dependencies = _Dependencies();
		(dependencies.authority.bind as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ outcome: "conflict" });
		const response = await request(_App(dependencies)).post("/bind").set("authorization", "Bearer projected-token").send(_Proof());

		expect(response.status).toBe(409);
		expect(response.body).toEqual({ error: "warm_runtime_binding_conflict" });
	});

	it("marks an unreserved generic warm Pod as retryable", async function _ReportsUnreserved()
	{
		const dependencies = _Dependencies();
		(dependencies.authority.bind as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ outcome: "unreserved" });
		const response = await request(_App(dependencies)).post("/bind").set("authorization", "Bearer projected-token").send(_Proof());

		expect(response.status).toBe(409);
		expect(response.body).toEqual({ error: "warm_runtime_binding_unreserved" });
	});
});
