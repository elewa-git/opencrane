import assert from "node:assert/strict";
import test from "node:test";

import { createApplicationCommands, createKurrentCommand, createKurrentTlsVolumeCommand, createLiteLLMCommand, createPostgresCommand, createPostgresVolumeProvisionerCommand } from "../commands.mjs";
import { createLocalChildEnvironment } from "../command-runner.mjs";
import { LOCAL_DEVELOPMENT_ALTERNATIVES } from "../profiles.mjs";

const configuration = {
	alternative: undefined,
	baselineDigest: "baseline",
	browserOrigin: "http://local-development.localhost:4200",
	developmentProfile: "core",
	internalPort: 8_081,
	kurrentContainerName: "kurrent",
	kurrentImage: "kurrent@sha256:test",
	kurrentPort: 21_139,
	kurrentVolumeName: "kurrent-volume",
	kurrentTlsProvisionerContainerName: "kurrent-tls-provisioner",
	kurrentTlsVolumeName: "kurrent-tls-volume",
	liteLLMContainerName: "litellm",
	liteLLMImage: "litellm@sha256:test",
	liteLLMPort: 4_000,
	networkName: "network",
	postgresContainerName: "postgres",
	postgresImage: "postgres@sha256:test",
	postgresPort: 54_329,
	postgresVolumeName: "postgres-volume",
	postgresVolumeProvisionerContainerName: "postgres-volume-provisioner",
	publicPort: 8_080,
	repositoryIdentity: "repository",
	uiPort: 4_200,
	worktreeIdentity: "worktree"
};
const secrets = {
	browserSessionCredentialPath: "/tmp/browser-session",
	caCertificatePath: "/tmp/ca-cert",
	conversationKeyringPath: "/tmp/keyring",
	invitationSigningKeyPath: "/tmp/invitation",
	kurrentAdminPassword: "admin-secret",
	kurrentHistoryPasswordPath: "/tmp/history-password",
	kurrentHistoryUsernamePath: "/tmp/history-username",
	kurrentOpsPassword: "ops-secret",
	liteLLMDatabasePassword: "litellm-database-secret",
	liteLLMMasterKey: "litellm-secret",
	postgresPassword: "postgres-secret",
	privateKeyPath: "/tmp/key"
};
secrets.serverCertificatePath = "/tmp/server-cert";

test("container commands keep database credentials out of process arguments", function _SecretEnvironment()
{
	const postgres = createPostgresCommand(configuration, secrets);
	const kurrent = createKurrentCommand(configuration, secrets);
	assert.equal(postgres.arguments.join(" ").includes(secrets.postgresPassword), false);
	assert.equal(kurrent.arguments.join(" ").includes(secrets.kurrentAdminPassword), false);
	assert.equal(kurrent.arguments.includes("KURRENTDB_INSECURE=false"), true);
	assert.match(kurrent.arguments.join(" "), /127\.0\.0\.1:21139:2113/u);
	assert.equal(kurrent.arguments.includes("KURRENTDB_TRUSTED_ROOT_CERTIFICATES_PATH=/var/run/opencrane/local-tls/ca"), true);
	assert.equal(kurrent.arguments.some((argument) => argument.includes("target=/var/run/opencrane/local-tls/ca/tls.key")), false);
	assert.equal(kurrent.arguments.includes("--group-add"), false);
	assert.equal(kurrent.arguments.some((argument) => argument.includes("source=kurrent-tls-volume,target=/var/run/opencrane/local-tls,readonly")), true);
	const provision = createKurrentTlsVolumeCommand(configuration, { ...secrets, directory: "/tmp/session" });
	assert.equal(provision.arguments.join(" ").includes("admin-secret"), false);
	assert.equal(provision.arguments.includes("0:0"), true);
	assert.equal(provision.arguments.some((argument) => argument.includes("source=/tmp/session,target=/source,readonly")), true);
});

test("opt-in emulation targets every service image that needs AMD64 runtime support", function _Amd64Emulation()
{
	const emulated = { ...configuration, emulateAmd64: true };
	const postgres = createPostgresCommand(emulated, secrets);
	const kurrent = createKurrentCommand(emulated, secrets);
	const provisioner = createKurrentTlsVolumeCommand(emulated, { ...secrets, directory: "/tmp/session" });
	const postgresProvisioner = createPostgresVolumeProvisionerCommand(emulated);
	const provider = {
		generatedConfigPath: "/tmp/litellm.yaml",
		providerKey: "provider-secret",
		providerKeyEnvironmentVariable: "OPENCRANE_LOCAL_PROVIDER_KEY"
	};
	const liteLLM = createLiteLLMCommand(emulated, secrets, provider);

	for (const specification of [
		postgres,
		kurrent,
		provisioner,
		postgresProvisioner,
		liteLLM
	])
	{
		assert.deepEqual(specification.arguments.slice(0, 3), ["run", "--platform", "linux/amd64"]);
	}
});

test("PostgreSQL volume helper changes only the owned mount root while the server stays non-root", function _PostgresVolumePermissions()
{
	const helper = createPostgresVolumeProvisionerCommand(configuration);
	const postgres = createPostgresCommand(configuration, secrets);
	const argumentsList = helper.arguments;

	assert.equal(argumentsList.includes("postgres-volume-provisioner"), true);
	assert.equal(argumentsList.includes("--rm"), true);
	assert.equal(argumentsList.includes("--read-only"), true);
	assert.equal(argumentsList.includes("none"), true);
	assert.equal(argumentsList.includes("0:0"), true);
	assert.equal(argumentsList.includes("--privileged"), false);
	assert.equal(argumentsList.includes("type=volume,source=postgres-volume,target=/target"), true);
	assert.equal(argumentsList.some((argument) => argument.startsWith("type=bind,")), false);
	assert.equal(argumentsList.at(-3), "postgres@sha256:test");
	assert.equal(argumentsList.at(-1), "set -eu; chown 26:26 /target; chmod 0700 /target");
	assert.equal(argumentsList.at(-1).includes("-R"), false);
	assert.equal(postgres.arguments.includes("--user"), false);
	assert.equal(postgres.arguments.includes("/var/run/postgresql:uid=26,gid=26,mode=0700,size=16m"), true);
	assert.equal(postgres.arguments.filter((argument) => argument === "--tmpfs").length, 1);
	assert.deepEqual(helper.environment, {});
});

test("local LiteLLM receives its isolated database URL without putting credentials in Docker arguments", function _LiteLLMDatabase()
{
	const localConfiguration = { ...configuration, alternative: LOCAL_DEVELOPMENT_ALTERNATIVES.LocalLiteLLM };
	const provider = {
		generatedConfigPath: "/tmp/litellm.yaml",
		providerKey: "provider-secret",
		providerKeyEnvironmentVariable: "OPENCRANE_LOCAL_PROVIDER_KEY"
	};
	const postgres = createPostgresCommand(localConfiguration, secrets);
	const specification = createLiteLLMCommand(localConfiguration, secrets, provider);

	assert.equal(postgres.arguments.includes("127.0.0.1:4000:4000"), false);
	assert.equal(specification.arguments.includes("DATABASE_URL"), true);
	assert.equal(specification.arguments.includes("CUSTOM_TIKTOKEN_CACHE_DIR"), true);
	assert.equal(specification.arguments.includes("NO_PROXY"), true);
	assert.equal(specification.arguments.includes("no_proxy"), true);
	assert.equal(specification.arguments.join(" ").includes(provider.providerKey), false);
	assert.equal(specification.arguments.join(" ").includes(secrets.postgresPassword), false);
	assert.equal(specification.arguments.join(" ").includes(secrets.liteLLMDatabasePassword), false);
	assert.equal(specification.environment.OPENCRANE_LOCAL_PROVIDER_KEY, provider.providerKey);
	assert.equal(specification.environment.DATABASE_URL, "postgresql://litellm:litellm-database-secret@postgres:5432/litellm");
	assert.equal(specification.environment.DATABASE_URL.includes(secrets.postgresPassword), false);
	assert.equal(specification.environment.CUSTOM_TIKTOKEN_CACHE_DIR, "/usr/lib/python3.13/site-packages/litellm/litellm_core_utils/tokenizers");
	assert.equal(specification.environment.NO_PROXY, "127.0.0.1,localhost,::1");
	assert.equal(specification.environment.no_proxy, "127.0.0.1,localhost,::1");
});

test("Codespaces LiteLLM shares PostgreSQL loopback while its host port stays private", function _CodespacesLiteLLMNetwork()
{
	const codespace = {
		...configuration,
		alternative: LOCAL_DEVELOPMENT_ALTERNATIVES.LocalLiteLLM,
		codespaceName: "careful-crane-123"
	};
	const provider = {
		generatedConfigPath: "/tmp/litellm.yaml",
		providerKey: "provider-secret",
		providerKeyEnvironmentVariable: "OPENCRANE_LOCAL_PROVIDER_KEY"
	};
	const postgres = createPostgresCommand(codespace, secrets);
	const liteLLM = createLiteLLMCommand(codespace, secrets, provider);

	assert.equal(postgres.arguments.includes("127.0.0.1:54329:5432"), true);
	assert.equal(postgres.arguments.includes("127.0.0.1:4000:4000"), true);
	assert.equal(liteLLM.arguments.includes("container:postgres"), true);
	assert.equal(liteLLM.arguments.includes("network"), false);
	assert.equal(liteLLM.arguments.includes("127.0.0.1:4000:4000"), false);
	assert.equal(liteLLM.environment.DATABASE_URL, "postgresql://litellm:litellm-database-secret@127.0.0.1:5432/litellm");
});

test("application plans start only the current server and Tier 2 UI", function _CurrentProcesses()
{
	const commands = createApplicationCommands(configuration, secrets);
	assert.deepEqual(commands.map((command) => command.name), ["opencrane-server", "opencrane-ui"]);
	assert.deepEqual(commands[0].arguments, ["tsx", "apps/opencrane/src/development/index.ts"]);
	assert.deepEqual(commands[1].arguments, [
		"nx",
		"run",
		"opencrane-ui:serve-browser:tier2",
		"--host=local-development.localhost",
		"--port=4200",
		"--output-style=stream",
	]);
	assert.equal(commands[0].environment.OPENCRANE_LOCAL_DEVELOPMENT_PROFILE, "core");
	assert.equal(commands[0].environment.OPENCRANE_LOCAL_KURRENTDB_CA_PATH, secrets.caCertificatePath);
	assert.equal(commands[0].environment.OPENCRANE_LOCAL_BROWSER_SESSION_CREDENTIAL_PATH, secrets.browserSessionCredentialPath);
});

test("Codespaces UI and server share one exact HTTPS forwarded browser origin", function _CodespacesProcesses()
{
	const codespace = {
		...configuration,
		browserOrigin: "https://careful-crane-123-4200.app.github.dev",
		codespaceName: "careful-crane-123",
		codespacesForwardingDomain: "app.github.dev"
	};
	const commands = createApplicationCommands(codespace, secrets);
	assert.equal(commands[0].environment.OPENCRANE_LOCAL_BROWSER_ORIGIN, codespace.browserOrigin);
	assert.equal(commands[1].arguments.includes("--host=0.0.0.0"), true);
	assert.equal(commands[1].environment.__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS, "careful-crane-123-4200.app.github.dev");
});

test("child processes receive explicit settings without ambient credentials", function _FilteredEnvironment()
{
	const parentEnvironment = {
		PATH: "/bin",
		AWS_SECRET_ACCESS_KEY: "ambient-secret",
		OPENAI_TIER2_PROVIDER_API_KEY: "codespaces-secret",
		OPENCRANE_TIER2_DEFAULT_PROVIDER: "openai",
	};
	const environment = createLocalChildEnvironment(parentEnvironment, { DATABASE_URL: "local" });
	assert.deepEqual(environment, { PATH: "/bin", DATABASE_URL: "local" });
});
