import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

/** Read one repository JSON document used by the Tier 2 build contract. */
function _ReadJson(path: string): Record<string, unknown>
{
	return JSON.parse(readFileSync(resolve(process.cwd(), "../..", path), "utf8")) as Record<string, unknown>;
}

describe("Tier 2 live-gateway serve configuration", function _Tier2ServeConfiguration()
{
	it("keeps the remote development proxy separate from the loopback Tier 2 server", function _SeparateProxyTargets()
	{
		const project = _ReadJson("apps/opencrane-ui/project.json") as { targets: { serve: { options: { allowedHosts: string[] }; configurations: Record<string, { allowedHosts?: string[]; buildTarget: string; proxyConfig: string }> } } };
		const remote = _ReadJson("apps/opencrane-ui/proxy.dev-live.conf.json") as Record<string, { target: string }>;
		const tier2 = _ReadJson("apps/opencrane-ui/proxy.tier2.conf.json") as Record<string, { target: string; changeOrigin: boolean; xfwd: boolean }>;

		expect(project.targets.serve.configurations.tier2).toEqual({
			buildTarget: "opencrane-ui:build:development-tier2",
			allowedHosts: ["local-development.localhost"],
			proxyConfig: "apps/opencrane-ui/proxy.tier2.conf.json",
		});
		expect(project.targets.serve.options.allowedHosts).not.toContain("local-development.localhost");
		expect(remote["/api/v1"]?.target).toBe("https://platform.dev.opencrane.ai");
		expect(tier2["/api/v1"]).toEqual(expect.objectContaining({
			target: "http://127.0.0.1:8080",
			changeOrigin: true,
			xfwd: true,
		}));
		const tier2Build = (project as unknown as { targets: { build: { configurations: Record<string, { fileReplacements?: Array<{ replace: string; with: string }> }> } } }).targets.build.configurations["development-tier2"];
		expect(tier2Build.fileReplacements).toContainEqual({ replace: "apps/opencrane-ui/src/app/http-profile.provider.ts", with: "apps/opencrane-ui/src/app/http-profile.provider.tier2.ts" });
	});
});
