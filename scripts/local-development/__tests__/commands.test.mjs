import assert from "node:assert/strict";
import test from "node:test";

import { createApplicationCommands, createKurrentCommand, createKurrentTlsVolumeCommand, createPostgresCommand } from "../commands.mjs";
import { createLocalChildEnvironment } from "../command-runner.mjs";

const configuration = {
	alternative: undefined,
	baselineDigest: "baseline",
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
	assert.equal(kurrent.arguments.some(function _KeyInRoots(argument) { return argument.includes("target=/var/run/opencrane/local-tls/ca/tls.key"); }), false);
	assert.equal(kurrent.arguments.includes("--group-add"), false);
	assert.equal(kurrent.arguments.some(function _TlsVolume(argument) { return argument.includes("source=kurrent-tls-volume,target=/var/run/opencrane/local-tls,readonly"); }), true);
	const provision = createKurrentTlsVolumeCommand(configuration, { ...secrets, directory: "/tmp/session" });
	assert.equal(provision.arguments.join(" ").includes("admin-secret"), false);
	assert.equal(provision.arguments.includes("0:0"), true);
	assert.equal(provision.arguments.some(function _CopiesOwnerOnlySource(argument) { return argument.includes("source=/tmp/session,target=/source,readonly"); }), true);
});

test("application plans start only the current server and Tier 2 UI", function _CurrentProcesses()
{
	const commands = createApplicationCommands(configuration, secrets);
	assert.deepEqual(commands.map(function _Name(command) { return command.name; }), ["opencrane-server", "opencrane-ui"]);
	assert.deepEqual(commands[0].arguments, ["tsx", "apps/opencrane/src/development/index.ts"]);
	assert.equal(commands[0].environment.OPENCRANE_LOCAL_DEVELOPMENT_PROFILE, "core");
	assert.equal(commands[0].environment.OPENCRANE_LOCAL_KURRENTDB_CA_PATH, secrets.caCertificatePath);
	assert.equal(commands[0].environment.OPENCRANE_LOCAL_BROWSER_SESSION_CREDENTIAL_PATH, secrets.browserSessionCredentialPath);
});

test("child processes receive explicit settings without ambient credentials", function _FilteredEnvironment()
{
	const environment = createLocalChildEnvironment({ PATH: "/bin", AWS_SECRET_ACCESS_KEY: "ambient-secret" }, { DATABASE_URL: "local" });
	assert.deepEqual(environment, { PATH: "/bin", DATABASE_URL: "local" });
});
