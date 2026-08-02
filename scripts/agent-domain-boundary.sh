#!/usr/bin/env bash
set -euo pipefail

ROOT="${AGENT_DOMAIN_BOUNDARY_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"

node --input-type=module - "$ROOT" <<'NODE'
import { existsSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

const [, , root] = process.argv;
const errors = [];
const domains = [
  { kind: "personal", directory: "libs/backend/agents/personal/configuration/main", project: "backend-agents-personal-configuration", alias: "@opencrane/backend/agents/personal/configuration", scope: "scope:personal-configuration" },
  { kind: "personal", directory: "libs/backend/agents/personal/personas/main", project: "backend-agents-personal-personas", alias: "@opencrane/backend/agents/personal/personas", scope: "scope:personal-personas" },
  { kind: "personal", directory: "libs/backend/agents/personal/memory/main", project: "backend-agents-personal-memory", alias: "@opencrane/backend/agents/personal/memory", scope: "scope:personal-memory" },
  { kind: "shared execution", directory: "libs/backend/agents/execution/admission/main", project: "backend-agents-execution-admission", alias: "@opencrane/backend/agents/execution/admission", scope: "scope:execution-admission" },
  { kind: "shared execution", directory: "libs/backend/agents/execution/inputs/main", project: "backend-agents-execution-inputs", alias: "@opencrane/backend/agents/execution/inputs", scope: "scope:execution-inputs" },
  { kind: "shared execution", directory: "libs/backend/agents/execution/runs/main", project: "backend-agents-execution-runs", alias: "@opencrane/backend/agents/execution/runs", scope: "scope:execution-runs" },
  { kind: "shared execution", directory: "libs/backend/agents/execution/protocol", project: "backend-agents-execution-protocol", alias: "@opencrane/backend/agents/execution/protocol", scope: "scope:execution-protocol" },
  { kind: "operator", directory: "libs/backend/server/iam/membership/main", project: "backend-server-membership", alias: "@opencrane/backend/server/iam/membership", scope: "scope:membership" },
  { kind: "operator", directory: "libs/backend/server/iam/authorization/main", project: "backend-server-authorization", alias: "@opencrane/backend/server/iam/authorization", scope: "scope:authorization" },
  { kind: "operator", directory: "libs/backend/server/agents/agent-services/main", project: "backend-server-agent-services", alias: "@opencrane/backend/server/agents/agent-services", scope: "scope:agent-services" },
  { kind: "operator", directory: "libs/backend/server/gateways/integrations/main", project: "backend-server-integrations", alias: "@opencrane/backend/server/gateways/integrations", scope: "scope:integrations" },
];

function fail(message)
{
  errors.push(message);
}

function readJson(path)
{
  try
  {
    return JSON.parse(readFileSync(path, "utf8"));
  }
  catch (error)
  {
    fail(`cannot parse ${relative(root, path)}: ${error.message}`);
    return {};
  }
}

const tsconfig = readJson(join(root, "tsconfig.json"));
const eslintPath = join(root, "eslint.config.mjs");
const eslintConfig = existsSync(eslintPath) ? readFileSync(eslintPath, "utf8") : "";
if (!existsSync(eslintPath)) fail("missing eslint.config.mjs");

for (const domain of domains)
{
  const projectPath = join(root, domain.directory, "project.json");
  const indexPath = `./${domain.directory}/src/index.ts`;
  if (!existsSync(projectPath))
  {
    fail(`missing ${domain.kind} domain project: ${domain.directory}/project.json`);
    continue;
  }

  const project = readJson(projectPath);
  const tags = project.tags ?? [];
  const scopeTags = tags.filter(function isScope(tag) { return tag.startsWith("scope:"); });
  const context = `${domain.directory}/project.json`;
  if (project.name !== domain.project) fail(`${context}: project name must be ${domain.project}`);
  if (project.projectType !== "library") fail(`${context}: projectType must be library`);
  if (project.sourceRoot !== `${domain.directory}/src`) fail(`${context}: sourceRoot must remain ${domain.directory}/src`);
  if (!tags.includes("type:lib") || !tags.includes("layer:backend") || scopeTags.length !== 1 || scopeTags[0] !== domain.scope)
  {
    fail(`${context}: tags must be type:lib, layer:backend, and exactly ${domain.scope}`);
  }
  const aliasTarget = tsconfig.compilerOptions?.paths?.[domain.alias];
  if (!Array.isArray(aliasTarget) || aliasTarget.length !== 1 || aliasTarget[0] !== indexPath)
  {
    fail(`TypeScript alias ${domain.alias} must resolve exactly to ${indexPath}`);
  }
  if (!eslintConfig.includes(`sourceTag: "${domain.scope}"`)) fail(`missing ESLint dependency constraint for ${domain.scope}`);
}

if (errors.length > 0)
{
  process.stderr.write("Agent-domain boundary guard failed:\n");
  for (const error of errors) process.stderr.write(`  - ${error}\n`);
  process.exit(1);
}

const count = function count(kind) { return domains.filter(function matches(domain) { return domain.kind === kind; }).length; };
process.stdout.write(`Agent-domain boundary guard passed: ${count("personal")} personal, ${count("shared execution")} shared execution, and ${count("operator")} operator domains are exactly configured.\n`);
NODE
