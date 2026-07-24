import type { PrismaClient } from "@prisma/client";
import type { NextFunction, Request, Response } from "express";
import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";

import { _CreatePersonaOnboardingRouter } from "../persona-onboarding-wiring.js";

/** Build the public router with an authenticated session and a membership read-model response. */
function _App(membership: { readonly status: "Active" | "Suspended" } | null)
{
	const prisma = { orgMembership: { findUnique: vi.fn().mockResolvedValue(membership) } } as unknown as PrismaClient;
	const app = express();
	app.use(express.json());
	app.use(function _Session(request: Request, response: Response, next: NextFunction): void
	{
		request.session = { authUser: { sub: "oidc-subject" } } as never;
		next();
	});
	app.use(_CreatePersonaOnboardingRouter(prisma));
	return { app, prisma };
}

describe("persona onboarding app wiring", function _DescribePersonaOnboardingWiring()
{
	it("denies a valid session that lacks membership in the silo selected by its host", async function _DeniesForeignSilo()
	{
		const { app, prisma } = _App(null);
		const response = await request(app).post("/onboarding/interviews").set("host", "silo-1.example.test").send({});
		expect(response.status).toBe(401);
		expect(prisma.orgMembership.findUnique).toHaveBeenCalledWith({ where: { clusterTenant_subject: { clusterTenant: "silo-1", subject: "oidc-subject" } }, select: { status: true } });
	});

	it("denies a suspended member before any persona profile can be resolved", async function _DeniesSuspendedMember()
	{
		const { app } = _App({ status: "Suspended" });
		expect((await request(app).get("/onboarding/questions").set("host", "silo-1.example.test")).status).toBe(401);
	});

	it("reports membership-read failure as unavailable rather than pretending the session is invalid", async function _ReportsMembershipUnavailable()
	{
		const rejected = vi.fn().mockRejectedValue(new Error("database unavailable"));
		const prisma = { orgMembership: { findUnique: rejected } } as unknown as PrismaClient;
		const failureApp = express();
		failureApp.use(express.json());
		failureApp.use(function _Session(request: Request, response: Response, next: NextFunction): void { request.session = { authUser: { sub: "oidc-subject" } } as never; next(); });
		failureApp.use(_CreatePersonaOnboardingRouter(prisma));
		expect((await request(failureApp).get("/onboarding/questions").set("host", "silo-1.example.test")).status).toBe(503);
	});
});
