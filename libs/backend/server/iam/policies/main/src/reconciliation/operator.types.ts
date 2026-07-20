/** Configuration required by the AccessPolicy reconciliation loop. */
export interface PolicyOperatorConfig
{
  /** Namespace watched for AccessPolicy resources; empty means cluster-wide. */
  watchNamespace: string;
}
