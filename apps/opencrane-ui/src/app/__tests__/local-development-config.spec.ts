import fs from "node:fs";
import { describe, expect, it } from "vitest";

import openCraneUiProject from "../../../project.json";
import liveProxy from "../../../proxy.dev-live.conf.json";

/** Reads UI Elements targets as test data without creating a source dependency on that library. */
const _UI_ELEMENTS_PROJECT = JSON.parse(fs.readFileSync(new URL("../../../../../libs/frontend/elements/ui/project.json", import.meta.url), "utf8"));

/** Explicit local serve configurations and the archetypes they inject. */
const _ARCHETYPE_CONFIGURATIONS = {
	"development-commander": "commander",
	"development-catalyst": "catalyst",
	"development-anchor": "anchor",
	"development-analyst": "analyst"
} as const;

describe("OpenCrane UI local-development commands", function _Suite()
{
	it("maps every explicit archetype configuration through the local build", function _ArchetypeConfigurations()
	{
		const development = openCraneUiProject.targets.build.configurations.development;

		for (const [configuration, archetype] of Object.entries(_ARCHETYPE_CONFIGURATIONS))
		{
			const serveBrowser = openCraneUiProject.targets["serve-browser"].configurations[configuration as keyof typeof _ARCHETYPE_CONFIGURATIONS];
			const serve = openCraneUiProject.targets.serve.configurations[configuration as keyof typeof _ARCHETYPE_CONFIGURATIONS];
			const build = openCraneUiProject.targets.build.configurations[configuration as keyof typeof _ARCHETYPE_CONFIGURATIONS];

			expect(serveBrowser.buildTarget).toBe(`opencrane-ui:build:${configuration}`);
			expect({ ...build, define: undefined }).toEqual({ ...development, define: undefined });
			expect(build.define).toEqual({
				OPENCRANE_LOCAL_DEVELOPMENT_ARCHETYPE: `"${archetype}"`
			});
			expect(serve.args).toBe(`--uiConfiguration=${configuration}`);
		}
	});

	it("bundles the routed UI, interactive Storybook, and static Playwright visual pass", function _CompositeServe()
	{
		const commands = openCraneUiProject.targets.serve.options.commands.map(command => command.command);

		expect(commands).toEqual([
			"nx run opencrane-ui:serve-browser:{args.uiConfiguration}",
			"nx run frontend-elements-ui:storybook",
			"nx run frontend-elements-ui:test-storybook-visual-workbench"
		]);
		expect(_UI_ELEMENTS_PROJECT.targets["static-storybook-workbench"].options.port).toBe(4401);
		expect(_UI_ELEMENTS_PROJECT.targets["test-storybook-visual-workbench"].dependsOn).toEqual(["static-storybook-workbench"]);
		expect(_UI_ELEMENTS_PROJECT.targets["test-storybook-visual-workbench"].options.env).toEqual({ OPENCRANE_STORYBOOK_BASE_URL: "http://127.0.0.1:4401" });
	});

	it("keeps development-live on the single real-backend browser server", function _LiveServe()
	{
		const live = openCraneUiProject.targets.serve.configurations["development-live"];
		const liveBrowser = openCraneUiProject.targets["serve-browser"].configurations["development-live"];

		expect(live.args).toBe("--uiConfiguration=development-live");
		expect(live.commands).toEqual([
			{
				command: "nx run opencrane-ui:serve-browser:{args.uiConfiguration}",
				forwardAllArgs: false
			}
		]);
		expect(liveBrowser).toMatchObject({
			host: "local-development.localhost",
			port: 4200,
			proxyConfig: "apps/opencrane-ui/proxy.dev-live.conf.json"
		});
		expect(liveProxy["/api/v1"].ws).toBe(true);
	});
});
