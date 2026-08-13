/**
 * `@opencrane/backend/server/infra/api` — the small pieces of Kubernetes plumbing the
 * OpenCrane server shares. Two things only:
 *
 *   - The custom-resource identity constants — API group, version, and the ClusterTenant
 *     plural — so no caller retypes them (./crd-constants.ts).
 *   - Helpers that recognise a Kubernetes 404 or 409 whatever shape the client library
 *     reported it in (./k8s-errors.ts).
 *
 * @see https://kubernetes.io/docs/concepts/extend-kubernetes/api-extension/custom-resources/
 *      — what the group, version, and plural below identify.
 */
export * from "./crd-constants.js";
export * from "./k8s-errors.js";
