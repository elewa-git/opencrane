import { AgentConfigPatchKinds } from "@opencrane/contracts";
import { z } from "zod";

import type { PersonalConfigurationPatch } from "./personal-configuration-patch.types.js";

/** Bounded model alias accepted by the future-revision materialisation authority. */
const _ModelAliasSchema = z.string().max(200).refine(function _NonBlank(value) { return value.trim().length > 0; }, "must not be blank");

/** Strict closed patch vocabulary shared by proposal admission and persisted-row hydration. */
export const _PersonalConfigurationPatchSchema: z.ZodType<PersonalConfigurationPatch> = z.discriminatedUnion("kind", [
	z.object({ kind: z.literal(AgentConfigPatchKinds.PersonaRefresh) }).strict(),
	z.object({ kind: z.literal(AgentConfigPatchKinds.ModelAlias), modelAlias: _ModelAliasSchema }).strict(),
]);

/** Return whether a runtime value matches the closed personal configuration-patch union. */
export function _IsPersonalConfigurationPatch(value: unknown): value is PersonalConfigurationPatch
{
	return _PersonalConfigurationPatchSchema.safeParse(value).success;
}
