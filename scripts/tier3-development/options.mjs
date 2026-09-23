import { readFileSync } from "node:fs";

const _PROFILES = new Set(["infra", "agent"]);
const _STORAGE_MODES = new Set(["fast", "full"]);
const _PROVIDERS = new Set(Object.keys(JSON.parse(readFileSync(new URL("../../libs/backend/server/gateways/model-routing/main/byok-provider-catalog.json", import.meta.url), "utf8"))));

/** Explains the strict profile, storage, ownership, browser, and provider options accepted below. */
export const TIER3_HELP = `Usage: node scripts/tier3-development.mjs --profile <infra|agent> [options]\n\nOptions:\n  --storage-mode <fast|full>   Select disposable or persistent storage qualification.\n  --proxy-port <port>          Bind the loopback browser proxy (default: 4200).\n  --replace-owned              Replace only a retained cluster owned by this worktree.\n  --smoke-only                 Qualify infrastructure without starting the browser proxy.\n  --provider <name>            Select a reviewed BYOK provider for the agent profile.\n  --default-provider <name>    Set this launch's fallback provider.\n  --provider-key-file <path>   Workstation owner-only provider-key file.\n  --help                       Show this help.\n`;

/**
 * Parses and validates a Tier 3 command before any host resource is acquired.
 * Infra mode refuses provider inputs. Agent mode validates explicit provider names here, then the
 * environment-aware credential resolver admits a Codespaces secret or owner-only workstation file.
 * @returns Frozen options for exactly one admitted Tier 3 profile.
 * @throws When an option is unknown, incomplete, unsupported, or incompatible with its profile.
 */
export function parseTier3Options(arguments_)
{
	const options = {
		defaultProvider: null,
		help: false,
		profile: null,
		provider: null,
		providerKeyFile: null,
		proxyPort: 4_200,
		replaceOwned: false,
		smokeOnly: false,
		storageMode: "fast"
	};
	for (let index = 0; index < arguments_.length; index += 1)
	{
		const argument = arguments_[index];
		if (argument === "--help") options.help = true;
		else if (argument === "--replace-owned") options.replaceOwned = true;
		else if (argument === "--smoke-only") options.smokeOnly = true;
		else if (argument === "--profile") options.profile = _Value(arguments_, ++index, argument);
		else if (argument === "--storage-mode") options.storageMode = _Value(arguments_, ++index, argument);
		else if (argument === "--proxy-port") options.proxyPort = Number(_Value(arguments_, ++index, argument));
		else if (argument === "--provider") options.provider = _Value(arguments_, ++index, argument).toLowerCase();
		else if (argument === "--default-provider") options.defaultProvider = _Value(arguments_, ++index, argument).toLowerCase();
		else if (argument === "--provider-key-file") options.providerKeyFile = _Value(arguments_, ++index, argument);
		else throw new Error(`Unknown Tier 3 option: ${argument}`);
	}
	if (options.help) return options;
	if (!_PROFILES.has(options.profile)) throw new Error("Tier 3 profile must be infra or agent.");
	if (!_STORAGE_MODES.has(options.storageMode)) throw new Error("Tier 3 storage mode must be fast or full.");
	if (!Number.isSafeInteger(options.proxyPort) || options.proxyPort < 1_024 || options.proxyPort > 65_535) throw new Error("Tier 3 proxy port must be a user port from 1024 through 65535.");
	if (options.profile === "infra" && (options.provider !== null || options.defaultProvider !== null || options.providerKeyFile !== null)) throw new Error("Tier 3 infra refuses provider credentials.");
	if (options.profile === "agent" && options.provider && !_PROVIDERS.has(options.provider)) throw new Error(`Tier 3 provider must be one of ${[..._PROVIDERS].join(", ")}.`);
	if (options.profile === "agent" && options.defaultProvider && !_PROVIDERS.has(options.defaultProvider)) throw new Error(`Tier 3 default provider must be one of ${[..._PROVIDERS].join(", ")}.`);
	if (options.profile === "agent" && options.smokeOnly) throw new Error("Tier 3 agent cannot use --smoke-only because it must prove a real assistant turn.");
	return Object.freeze(options);
}

function _Value(arguments_, index, option)
{
	const value = arguments_[index];
	if (!value || value.startsWith("--")) throw new Error(`${option} requires a value.`);
	return value;
}
