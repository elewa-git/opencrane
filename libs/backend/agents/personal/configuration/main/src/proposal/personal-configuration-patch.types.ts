import { AgentConfigPatchKinds } from "@opencrane/contracts";

/** The configuration changes a user may request; a later personal agent revision materialises them. */
export type PersonalConfigurationPatch = { readonly kind: AgentConfigPatchKinds.PersonaRefresh } | { readonly kind: AgentConfigPatchKinds.ModelAlias; readonly modelAlias: string };
