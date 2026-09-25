import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { loadAll } from "js-yaml";

/** Refuse hosted qualification unless the server really mounts the selected certificate bundle. */
export function assertHostedServerTrust(resources)
{
  const deployments = resources.filter(resource => resource?.kind === "Deployment" && resource.metadata?.name === "opencrane-smoke-opencrane-server");
  const template = deployments.length === 1 ? deployments[0].spec?.template : null;
  const containers = template?.spec?.containers ?? [];
  const servers = containers.filter(container => container.name === "opencrane-ui");
  const environment = servers.length === 1 ? servers[0].env?.filter(entry => entry.name === "NODE_EXTRA_CA_CERTS") : [];
  const mount = servers.length === 1 ? servers[0].volumeMounts?.find(item => item.name === "additional-ca-certificates") : null;
  const volume = template?.spec?.volumes?.find(item => item.name === "additional-ca-certificates");
  const items = volume?.secret?.items;
  if (template?.metadata?.annotations?.["opencrane.ai/additional-ca-certificates-revision"] !== "hosted-generated-file-v1"
      || environment?.length !== 1 || environment[0]?.value !== "/var/run/opencrane/outbound-ca/ca.crt"
      || mount?.mountPath !== "/var/run/opencrane/outbound-ca" || mount?.readOnly !== true
      || volume?.secret?.secretName !== "hosted-generated-file-ca" || volume?.secret?.defaultMode !== 0o440 || volume?.secret?.optional === true
      || items?.length !== 1 || items[0]?.key !== "ca.crt" || items[0]?.path !== "ca.crt")
    throw new Error("Hosted qualification is blocked: the rendered server does not support the reviewed outbound CA bundle; source approval remains required");
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
{
  try
  {
    assertHostedServerTrust(loadAll(readFileSync(0, "utf8")));
  }
  catch (error)
  {
    process.stderr.write(`${error instanceof Error ? error.message : "Hosted server trust validation failed"}\n`);
    process.exitCode = 1;
  }
}
