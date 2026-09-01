import fs from "node:fs";
import { describe, expect, it } from "vitest";

import openCraneUiProject from "../../../project.json";

/** Reads UI Elements targets as test data without creating a source dependency on that library. */
const _UI_ELEMENTS_PROJECT = JSON.parse(fs.readFileSync(new URL("../../../../../libs/frontend/elements/ui/project.json", import.meta.url), "utf8"));

/** Reads root scripts as command-contract data without creating a source dependency on the workspace root. */
const _ROOT_PACKAGE = JSON.parse(fs.readFileSync(new URL("../../../../../package.json", import.meta.url), "utf8"));

/** Maps public local serve configurations to their internal builds and injected archetypes. */
const _ARCHETYPE_CONFIGURATIONS = {
	commander: {
		buildConfiguration: "development-commander",
		archetype: "commander"
	},
	catalyst: {
		buildConfiguration: "development-catalyst",
		archetype: "catalyst"
	},
	anchor: {
		buildConfiguration: "development-anchor",
		archetype: "anchor"
	},
	analyst: {
		buildConfiguration: "development-analyst",
		archetype: "analyst"
	}
} as const;

describe("OpenCrane UI local-development commands", function _Suite()
{
	it("maps every explicit archetype configuration through the local build", function _ArchetypeConfigurations()
	{
		const development = openCraneUiProject.targets.build.configurations.development;

		for (const [configuration, selection] of Object.entries(_ARCHETYPE_CONFIGURATIONS))
		{
			const serveBrowser = openCraneUiProject.targets["serve-browser"].configurations[selection.buildConfiguration];
			const serve = openCraneUiProject.targets.serve.configurations[configuration as keyof typeof _ARCHETYPE_CONFIGURATIONS];
			const build = openCraneUiProject.targets.build.configurations[selection.buildConfiguration];

			expect(serveBrowser.buildTarget).toBe(`opencrane-ui:build:${selection.buildConfiguration}`);
			expect({ ...build, define: undefined }).toEqual({ ...development, define: undefined });
			expect(build.define).toEqual({
				OPENCRANE_LOCAL_DEVELOPMENT_ARCHETYPE: `"${selection.archetype}"`
			});
			expect(serve.args).toBe(`--uiConfiguration=${selection.buildConfiguration}`);
			expect(_ROOT_PACKAGE.scripts[`serve:opencrane-ui:${configuration}`]).toBe(`nx serve opencrane-ui --configuration=${configuration}`);
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

	it("keeps development-live internal for the Tier 2 coordinator", function _LiveServe()
	{
		expect(openCraneUiProject.targets["serve-browser"].configurations["development-live"].proxyConfig).toBe("apps/opencrane-ui/proxy.dev-live.conf.json");
		expect(openCraneUiProject.targets.serve.configurations).not.toHaveProperty("live");
		expect(_ROOT_PACKAGE.scripts).not.toHaveProperty("serve:opencrane-ui:live");
	});
});
