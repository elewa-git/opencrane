import { AgentConfigPatchKinds } from "@opencrane/contracts";

import type { PersonalConfigurationPatch } from "./personal-configuration.types.js";

/** Return whether a runtime value matches the closed personal configuration-patch union. */
export function _IsPersonalConfigurationPatch(value: unknown): value is PersonalConfigurationPatch
{
	if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
	const patch = value as Readonly<Record<string, unknown>>;
	if (patch.kind === AgentConfigPatchKinds.PersonaRefresh) return Object.keys(patch).length === 1;
	return patch.kind === AgentConfigPatchKinds.ModelAlias && typeof patch.modelAlias === "string" && patch.modelAlias.trim().length > 0 && patch.modelAlias.length <= 200 && Object.keys(patch).length === 2;
}
