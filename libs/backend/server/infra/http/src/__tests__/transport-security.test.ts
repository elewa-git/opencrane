import express from "express";
import type { Express } from "express";
import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";

import { _TransportSecurity } from "../index.js";

/** Build an app behind `trust proxy` so `X-Forwarded-Proto` drives `req.secure`. */
function _buildApp(): Express
{
	const app = express();
	app.set("trust proxy", 1);
	app.use(_TransportSecurity());
	app.get("/ping", function _ping(_req, res)
	{
		res.status(200).send("ok");
	});
	return app;
}

describe("_TransportSecurity", function _suite()
{
	afterEach(function _reset()
	{
		delete process.env.OPENCRANE_FORCE_HTTPS;
	});

	it("sets HSTS on a forwarded-HTTPS request", async function _hsts()
	{
		const res = await request(_buildApp()).get("/ping").set("X-Forwarded-Proto", "https");
		expect(res.status).toBe(200);
		expect(res.headers["strict-transport-security"]).toBe("max-age=63072000; includeSubDomains; preload");
	});

	it("does not set HSTS on a plain-HTTP request", async function _noHsts()
	{
		const res = await request(_buildApp()).get("/ping");
		expect(res.status).toBe(200);
		expect(res.headers["strict-transport-security"]).toBeUndefined();
	});

	it("passes plain HTTP through when redirect is disabled (ingress enforces TLS)", async function _passthrough()
	{
		const res = await request(_buildApp()).get("/ping");
		expect(res.status).toBe(200);
		expect(res.text).toBe("ok");
	});

	it("redirects safe methods to HTTPS when OPENCRANE_FORCE_HTTPS is on", async function _redirect()
	{
		process.env.OPENCRANE_FORCE_HTTPS = "true";
		const res = await request(_buildApp()).get("/ping").set("Host", "cp.example.com");
		expect(res.status).toBe(308);
		expect(res.headers.location).toBe("https://cp.example.com/ping");
	});

	it("treats a non-standard OPENCRANE_FORCE_HTTPS value as off", async function _nonStandardFlag()
	{
		process.env.OPENCRANE_FORCE_HTTPS = "maybe";
		const res = await request(_buildApp()).get("/ping");
		expect(res.status).toBe(200);
		expect(res.headers.location).toBeUndefined();
	});

	it("does not redirect unsafe methods even when forcing HTTPS", async function _noRedirectPost()
	{
		process.env.OPENCRANE_FORCE_HTTPS = "true";
		const app = _buildApp();
		app.post("/data", function _data(_req, res)
		{
			res.status(201).send("created");
		});
		const res = await request(app).post("/data");
		expect(res.status).toBe(201);
	});
});
