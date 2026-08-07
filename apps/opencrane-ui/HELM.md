# SPA Helm ownership

The OpenCrane UI application owns the optional chart-native SPA Deployment and Service as named Helm templates under `helm/`. The silo umbrella composes these resources with its parent release context.
