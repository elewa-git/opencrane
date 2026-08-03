import type * as k8s from "@kubernetes/client-node";

/** Narrow Kubernetes TokenReview seam used at the gateway boundary. */
export type TokenReviewApi = Pick<k8s.AuthenticationV1Api, "createTokenReview">;
