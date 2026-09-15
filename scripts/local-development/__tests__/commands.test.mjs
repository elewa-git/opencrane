import assert from "node:assert/strict";
import test from "node:test";

import { createApplicationCommands, createKurrentCommand, createKurrentTlsVolumeCommand, createPostgresCommand, createPostgresVolumeProvisionerCommand } from "../commands.mjs";
import { createLocalChildEnvironment } from "../command-runner.mjs";

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

test("opt-in emulation targets only AMD64-pinned database and TLS provisioner images", function _Amd64Emulation()
{
	const emulated = { ...configuration, emulateAmd64: true };
	const postgres = createPostgresCommand(emulated, secrets);
	const kurrent = createKurrentCommand(emulated, secrets);
	const provisioner = createKurrentTlsVolumeCommand(emulated, { ...secrets, directory: "/tmp/session" });
	const postgresProvisioner = createPostgresVolumeProvisionerCommand(emulated);

	for (const specification of [postgres, kurrent, provisioner, postgresProvisioner])
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
	const environment = createLocalChildEnvironment({ PATH: "/bin", AWS_SECRET_ACCESS_KEY: "ambient-secret" }, { DATABASE_URL: "local" });
	assert.deepEqual(environment, { PATH: "/bin", DATABASE_URL: "local" });
});
