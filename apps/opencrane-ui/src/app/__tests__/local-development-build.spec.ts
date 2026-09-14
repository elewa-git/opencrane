import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const project = JSON.parse(readFileSync(new URL("../../../project.json", import.meta.url), "utf8"));
const storybookProject = JSON.parse(readFileSync(new URL("../../../../../libs/frontend/elements/ui/project.json", import.meta.url), "utf8"));
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
		expect(project.targets.serve.configurations["development-live"].commands).toEqual(
			[
				{
					command: "nx run opencrane-ui:serve-browser:{args.uiConfiguration}",
					forwardAllArgs: false,
				}
			]);
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

	it("serves the routed UI and Storybook mocks while Playwright checks the same catalogue", function _CompleteFrontendWorkbench()
	{
		const commands = project.targets.serve.options.commands;
		expect(commands.map((command: { readonly command: string }) => command.command)).toEqual(
		[
			"nx run opencrane-ui:serve-browser:{args.uiConfiguration}",
			"nx run frontend-elements-ui:storybook",
			"nx run frontend-elements-ui:test-storybook-visual"
		]);
		expect(project.targets["serve-browser"].executor).toBe("@angular-devkit/build-angular:dev-server");
		expect(storybookProject.targets["static-storybook"].options.port).toBe(4401);
		expect(storybookProject.targets["test-storybook-visual"].options.command).toContain("http-get://127.0.0.1:4401/index.json");
	});
});
