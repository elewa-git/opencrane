/**
 * A forbidden L0 system-mechanic pattern and the human-readable label reported
 * when company/tenant content tries to assert it.
 */
export interface L0DirectivePattern
{
  /** Short label naming the platform mechanic this pattern guards. */
  label: string;
  /** Case-insensitive regular expression matching the forbidden directive. */
  pattern: RegExp;
}
