import type { PrismaClient } from "@prisma/client";
import type { NextFunction, Request, Response } from "express";
import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";

import { _CreatePersonalConfigurationDecisionRouter } from "../personal-configuration-wiring.js";

/** Build the composition router with one browser session and configurable active-membership result. */
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
	app.use("/api/v1", _CreatePersonalConfigurationDecisionRouter(prisma));
	return { app, prisma };
}

describe("personal configuration decision app wiring", function _DescribePersonalConfigurationDecisionWiring()
{
	it("requires active membership in the exact host-derived silo before reaching the decision authority", async function _DeniesForeignSilo()
	{
		const { app, prisma } = _App(null);
		const response = await request(app).post("/api/v1/personal-configuration-changes/change-1/decision").set("host", "silo-1.example.test").send({ decision: "accepted" });
		expect(response.status).toBe(401);
		expect(prisma.orgMembership.findUnique).toHaveBeenCalledWith({ where: { clusterTenant_subject: { clusterTenant: "silo-1", subject: "oidc-subject" } }, select: { status: true } });
	});

	it("denies a suspended member without reading or deciding a configuration change", async function _DeniesSuspendedMember()
	{
		const { app } = _App({ status: "Suspended" });
		expect((await request(app).post("/api/v1/personal-configuration-changes/change-1/decision").set("host", "silo-1.example.test").send({ decision: "accepted" })).status).toBe(401);
	});
});
