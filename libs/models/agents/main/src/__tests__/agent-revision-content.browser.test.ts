import { fileURLToPath } from "node:url";

import { build } from "esbuild";
import { describe, expect, it } from "vitest";

describe("agent revision content browser bundle", function _BrowserAgentRevisionContentBundleSuite()
{
	it("bundles the public digest implementation for the browser without Node built-ins", async function _BundlesForBrowser()
	{
		const result = await build({
			entryPoints: [fileURLToPath(new URL("../agent-revision-content.ts", import.meta.url))],
			bundle: true,
			format: "esm",
			platform: "browser",
			write: false,
			logLevel: "silent",
		});

		expect(result.outputFiles).toHaveLength(1);
		expect(result.outputFiles[0]?.text).not.toContain("node:crypto");
	});
});
