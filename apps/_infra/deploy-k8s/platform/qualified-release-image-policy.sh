#!/usr/bin/env bash

# Applies one reviewed image tag to every long-lived first-party service that is built from the
# same OpenCrane commit. The deploy engine calls this after operator-provided Helm values so a
# values file or command-line setter cannot split one qualified release across different builds.
append_authoritative_qualified_release_image_helm_args()
{
  local value_path
  for value_path in \
    channelProxy.image.tag \
    memoryGateway.image.tag \
    artifactService.image.tag; do
    helm_args+=(--set-literal "${value_path}=${IMAGE_TAG}")
  done
  helm_args+=(--set-literal "clustertenantManager.image.tag=${CP_TAG}")
}
