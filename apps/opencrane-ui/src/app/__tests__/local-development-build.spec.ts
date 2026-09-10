import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const project = JSON.parse(readFileSync(new URL("../../../project.json", import.meta.url), "utf8"));
const packageManifest = JSON.parse(readFileSync(new URL("../../../../../package.json", import.meta.url), "utf8"));

describe("Tier 1 local build composition", function _TierOneLocalBuildComposition()
{
	it("replaces live routes and gateways in the plain local build", function _PlainLocalBuild()
	{
		const replacements = project.targets.build.configurations.development.fileReplacements;
		expect(replacements).toContainEqual({ replace: "apps/opencrane-ui/src/app/gateway-profile.providers.ts", with: "apps/opencrane-ui/src/app/gateway-profile.providers.local.ts" });
		expect(replacements).toContainEqual({ replace: "apps/opencrane-ui/src/app/app.routes.ts", with: "apps/opencrane-ui/src/app/app.routes.local.ts" });
	});

	it("keeps production and development-live free of local module replacements", function _LiveBuilds()
	{
		const configurations = project.targets.build.configurations;
		expect(JSON.stringify(configurations.production)).not.toContain("local-development");
		expect(JSON.stringify(configurations.production)).not.toContain(".local.ts");
		expect(JSON.stringify(configurations["development-live"])).not.toContain("local-development");
		expect(JSON.stringify(configurations["development-live"])).not.toContain(".local.ts");
	});

	it("maps only the four reviewed archetypes to named local commands", function _NamedBuilds()
	{
		const configurations = project.targets.build.configurations;
		expect(configurations["development-commander"].define.OPENCRANE_LOCAL_DEVELOPMENT_ARCHETYPE).toBe("\"commander\"");
		expect(configurations["development-catalyst"].define.OPENCRANE_LOCAL_DEVELOPMENT_ARCHETYPE).toBe("\"catalyst\"");
		expect(configurations["development-anchor"].define.OPENCRANE_LOCAL_DEVELOPMENT_ARCHETYPE).toBe("\"anchor\"");
		expect(configurations["development-analyst"].define.OPENCRANE_LOCAL_DEVELOPMENT_ARCHETYPE).toBe("\"analyst\"");
		expect(packageManifest.scripts["serve:opencrane-ui"]).toBe("nx serve opencrane-ui");
		expect(packageManifest.scripts["serve:opencrane-ui:commander"]).toBe("nx serve opencrane-ui --configuration=commander");
		expect(packageManifest.scripts["serve:opencrane-ui:catalyst"]).toBe("nx serve opencrane-ui --configuration=catalyst");
		expect(packageManifest.scripts["serve:opencrane-ui:anchor"]).toBe("nx serve opencrane-ui --configuration=anchor");
		expect(packageManifest.scripts["serve:opencrane-ui:analyst"]).toBe("nx serve opencrane-ui --configuration=analyst");
	});
});
