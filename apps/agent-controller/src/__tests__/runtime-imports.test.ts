import { readFile } from "node:fs/promises";
import { isBuiltin } from "node:module";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { expect, it } from "vitest";

/** Builds the real entrypoint without writing files or starting the controller. */
it("keeps the worker bundle Prisma-free and uses only declared runtime packages", async function _runtimeImports()
{
	const root = fileURLToPath(new URL("../../../../", import.meta.url));
	const manifest = JSON.parse(await readFile(new URL("../../package.json", import.meta.url), "utf8"));
	const result = await build({ absWorkingDir: root, entryPoints: ["apps/agent-controller/src/index.ts"], bundle: true, platform: "node", format: "esm", packages: "external", sourcemap: true, outfile: "dist/apps/agent-controller/index.js", write: false, metafile: true });
	const externals = Object.values(result.metafile.outputs).flatMap(output => output.imports.filter(item => item.external).map(item => item.path));
	const prisma = [...Object.keys(result.metafile.inputs), ...externals].filter(path => /(?:^|[/\\])(?:@prisma|\.prisma|prisma|prisma-unit-of-work)(?:[/\\]|$)/u.test(path));
	expect(prisma).toEqual([]);
	const undeclared = externals.filter(specifier => !isBuiltin(specifier)).filter(specifier =>
	{
		const segments = specifier.split("/");
		const packageName = specifier.startsWith("@") ? segments.slice(0, 2).join("/") : segments[0];
		return !(packageName in manifest.dependencies);
	});
	expect(undeclared).toEqual([]);
});
