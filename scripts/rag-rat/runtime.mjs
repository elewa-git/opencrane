import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const _VERSION = "0.23.0";
const _PACKAGE = `@rag-rat/bin@${_VERSION}`;
const _PLATFORMS = Object.freeze({
	"darwin-arm64": Object.freeze({ executable: "rag-rat", sha256: "223060f897fb6d33cbec5dd64fe3227ff2a1740751492211c3b5fb093cc41b25" }),
	"linux-arm64": Object.freeze({ executable: "rag-rat", sha256: "fcf17592f6de9f2f0bad4ea19b9d400b163b3ddbe99c5a45aa8f7b99fc83a542" }),
	"linux-x64": Object.freeze({ executable: "rag-rat", sha256: "2cdcddf4595eb9dbc904749c987938716bdfb8464362ebe4917f0ef45b9659ff" }),
	"win32-x64": Object.freeze({ executable: "rag-rat.exe", sha256: "1857d4875399a54fd393dc3d8327c0598ae0fe0838939d9f4618805a13ef7491" }),
});

/**
 * Selects a cross-platform npm launch contract without asking Node to execute a Windows command shim.
 *
 * Called by: `___EnsureRagRatRuntime` when the reviewed runtime is absent or stale.
 *
 * @param {NodeJS.Platform} platform Node's operating-system identifier.
 * @param {string} nodeExecutable Absolute path to the running Node executable.
 * @param {string | undefined} npmExecPath npm's JavaScript entrypoint when called from an npm script.
 * @returns {{ readonly command: string; readonly argumentPrefix: readonly string[] }} Executable and arguments that precede npm's arguments.
 */
export function ___RagRatNpmInvocation(platform, nodeExecutable, npmExecPath)
{
	if (npmExecPath)
	{
		return Object.freeze({ command: nodeExecutable, argumentPrefix: Object.freeze([npmExecPath]) });
	}

	if (platform === "win32")
	{
		return Object.freeze({ command: "cmd.exe", argumentPrefix: Object.freeze(["/d", "/s", "/c", "npm.cmd"]) });
	}

	return Object.freeze({ command: "npm", argumentPrefix: Object.freeze([]) });
}

/**
 * Checks both the package version and executable digest before the runner trusts an installation.
 * Missing files, invalid package JSON, version drift, or changed executable bytes all return false.
 *
 * Called by: `___EnsureRagRatRuntime` before reuse and immediately after installation.
 *
 * @param {string} manifestPath Absolute path to the installed npm package manifest.
 * @param {string} executablePath Absolute path to the installed native executable.
 * @param {string} expectedVersion Reviewed npm package version.
 * @param {string} expectedSha256 Reviewed SHA-256 digest derived from the matching release archive.
 * @returns {boolean} Whether both the version and executable digest match.
 */
export function ___RagRatRuntimeIsCurrent(manifestPath, executablePath, expectedVersion, expectedSha256)
{
	if (!existsSync(manifestPath) || !existsSync(executablePath))
	{
		return false;
	}

	try
	{
		const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
		const actualSha256 = createHash("sha256").update(readFileSync(executablePath)).digest("hex");
		return manifest.version === expectedVersion && actualSha256 === expectedSha256;
	}
	catch
	{
		return false;
	}
}

function _RuntimePaths(runtimeRoot, platform)
{
	const packageRoot = join(runtimeRoot, "node_modules", "@rag-rat", "bin");
	return Object.freeze({
		executable: join(packageRoot, "node_modules", ".bin_real", platform.executable),
		manifest: join(packageRoot, "package.json"),
		ready: join(runtimeRoot, ".ready"),
		runtimeRoot,
	});
}

function _FindReviewedRuntime(runtimeParent, platform)
{
	if (!existsSync(runtimeParent))
	{
		return undefined;
	}

	const prefix = `${_VERSION}-`;
	for (const entry of readdirSync(runtimeParent, { withFileTypes: true }))
	{
		if (!entry.isDirectory() || !entry.name.startsWith(prefix))
		{
			continue;
		}

		const paths = _RuntimePaths(join(runtimeParent, entry.name), platform);
		if (existsSync(paths.ready) && ___RagRatRuntimeIsCurrent(paths.manifest, paths.executable, _VERSION, platform.sha256))
		{
			return paths;
		}
	}

	return undefined;
}

/**
 * Installs or reuses rag-rat only when its package version and executable digest match the reviewed
 * release, and keeps each candidate under a versioned machine-local directory.
 *
 * Concurrent first uses install into distinct candidates. A `.ready` marker is written only after
 * package-version and executable-digest verification, so crashed or partial candidates are ignored.
 *
 * Called by: the rag-rat CLI composition root before it launches any native command.
 *
 * @param {{ readonly platform: NodeJS.Platform; readonly architecture: string; readonly runtimeParent: string; readonly nodeExecutable: string; readonly npmExecPath?: string; readonly runInstaller: (command: string, arguments_: readonly string[]) => { readonly status: number; readonly errorMessage?: string }; readonly platforms?: Readonly<Record<string, { readonly executable: string; readonly sha256: string }>>; readonly candidateId?: string }} options Runtime identity and injected installation boundary.
 * @returns {{ readonly status: number; readonly executable?: string; readonly errorMessage?: string }} Status zero with a verified executable, or a nonzero installation or verification failure.
 * @throws {Error} When the runtime directory cannot be read, written, or removed, or the installer throws.
 * @see https://github.com/cq27-dev/rag-rat/tree/81bf9d1891c2a94a52d6edb69d4a09688ca9116b — the pinned v0.23.0 source and release documentation.
 */
export function ___EnsureRagRatRuntime(options)
{
	const platforms = options.platforms ?? _PLATFORMS;
	const platform = platforms[`${options.platform}-${options.architecture}`];
	if (!platform)
	{
		return Object.freeze({
			status: 1,
			errorMessage: `Rag-rat ${_VERSION} does not publish a reviewed binary for ${options.platform}-${options.architecture}. Use its documented Cargo installation.`,
		});
	}

	const reviewed = _FindReviewedRuntime(options.runtimeParent, platform);
	if (reviewed)
	{
		return Object.freeze({ status: 0, executable: reviewed.executable });
	}

	mkdirSync(options.runtimeParent, { recursive: true });
	const candidateId = options.candidateId ?? `${process.pid}-${randomUUID()}`;
	const paths = _RuntimePaths(join(options.runtimeParent, `${_VERSION}-${candidateId}`), platform);
	rmSync(paths.runtimeRoot, { force: true, recursive: true });
	const npm = ___RagRatNpmInvocation(options.platform, options.nodeExecutable, options.npmExecPath);
	const installation = options.runInstaller(npm.command, [
		...npm.argumentPrefix,
		"install",
		"--prefix",
		paths.runtimeRoot,
		"--no-save",
		"--no-package-lock",
		"--no-audit",
		"--no-fund",
		_PACKAGE,
	]);

	if (installation.status !== 0)
	{
		rmSync(paths.runtimeRoot, { force: true, recursive: true });
		return Object.freeze({ status: installation.status, errorMessage: installation.errorMessage ?? `Could not install the reviewed ${_PACKAGE} developer runtime.` });
	}

	if (!___RagRatRuntimeIsCurrent(paths.manifest, paths.executable, _VERSION, platform.sha256))
	{
		rmSync(paths.runtimeRoot, { force: true, recursive: true });
		return Object.freeze({ status: 1, errorMessage: `Refusing to execute rag-rat ${_VERSION}: the package version or executable SHA-256 did not match the reviewed release.` });
	}

	writeFileSync(paths.ready, JSON.stringify({ version: _VERSION }));
	return Object.freeze({ status: 0, executable: paths.executable });
}
