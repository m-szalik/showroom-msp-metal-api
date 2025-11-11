# Metal API Showroom Chart

Bundles the Metal API showroom integration for Gardener landscapes. The chart deploys the frontend UI, serves the content bundle, registers the ProviderMetadata & ContentConfiguration, and publishes the APIExport required by the platform mesh portal. An ingress controller such as Traefik must already be present in the target cluster.

## Prerequisites
- Container image with the pre-built Metal API frontend assets (default `ghcr.io/example/metal-api-frontend:0.0.1`).
- Traefik IngressClass named `traefik` (override `frontend.ingress.className` if different).
- DNS + certificate automation matching your environment (`frontend.ingress.annotations` and `frontend.ingress.tls`).
- Secret containing the kubeconfig for the remote portal cluster (see deployment guide).

## Default domain and routing
- Default hostname: `metal-api.example.com` (`global.subdomain` + `global.baseDomain`).
- Content configuration references `https://metal-api.example.com/content.json` unless overridden via values.
- Adjust ingress annotations/hostnames in `frontend.ingress.*` to match the DNS provider that issues certificates.

## Key values

| Value | Description | Default |
|-------|-------------|---------|
| `global.baseDomain` | Parent domain for the Metal API subdomain | `example.com` |
| `global.contentPath` | Path served by the frontend for the content bundle | `/content.json` |
| `frontend.image.repository` | Frontend container repository | `ghcr.io/example/metal-api-frontend` |
| `frontend.content.contentFile` | Source JSON file mounted into the container | `files/content.json` |
| `frontend.content.mount.path` | Target path inside the container | `/usr/share/nginx/html/content.json` |
| `frontend.ingress.tls.secretName` | TLS secret expected in the release namespace | `""` |
| `portalIntegration.enabled` | Toggle remote portal manifest application | `false` |
| `portalIntegration.kubeconfig.secretNamespace` | Namespace that stores the kubeconfig secret | `""` |

## Frontend deployment guide

The steps below show how the Metal API frontend is built, packaged and deployed through the chart as an OCI artifact.

### 1. Build and push the frontend image

```sh
docker login ghcr.io -u <github-username>
docker buildx build \
  --platform linux/amd64 \
  -f showroom-msp-metal-api/ui/frontend.Dockerfile \
  -t ghcr.io/apeirora/metal-api-frontend:0.0.1 \
  showroom-msp-metal-api \
  --push
```

### 2. Package and publish the chart (OCI)

```sh
helm package showroom-msp-metal-api/charts/metal-api -d /tmp
helm push /tmp/metal-api-0.1.4.tgz oci://ghcr.io/apeirora/charts
```

Adjust the version/tag as needed when you cut a new release.

### 3. Prepare required secrets

```sh
# Frontend pull secret in the workload namespace
kubectl create secret docker-registry ghcr-credentials \
  --namespace metal-api \
  --docker-server=ghcr.io \
  --docker-username=<github-username> \
  --docker-password=<github-token>

# Portal kubeconfig secret in the remote sync namespace
kubectl create secret generic pm-kcp-kubeconfig \
  --namespace api-syncagent \
  --from-file=kubeconfig=/path/to/portal/kubeconfig
```

Verify that `pm-kcp-kubeconfig` contains the `kubeconfig` key referenced by `portalIntegration.kubeconfig.key`.

### 4. Deploy the chart from the OCI registry

```sh
helm upgrade --install metal-api \
  oci://ghcr.io/apeirora/charts/metal-api \
  --version 0.1.4 \
  --namespace metal-api \
  --create-namespace \
  -f showroom-msp-metal-api/charts/metal-api/values.deploy.yaml \
  --set frontend.image.pullPolicy=Always \
  --wait --timeout 10m0s
```

The included `values.deploy.yaml` sets:
- Domain & content path (`global.*`)
- Image repository/tag & pull secret (`frontend.image*` / `frontend.imagePullSecrets`)
- Portal integration kubeconfig location (`portalIntegration.kubeconfig.*`)

### 5. Validate the deployment

```sh
helm status metal-api -n metal-api
kubectl get pods -n metal-api
kubectl get configmap metal-api-content -n metal-api -o yaml
kubectl get jobs -n api-syncagent | grep metal-api-portal-integration
```

The portal-integration job should complete, leaving the ConfigMaps in `api-syncagent` populated and no running pods.

## Related configuration
- Portal integration ConfigMaps (`*-portal-integration-*`) are rendered with metadata from `templates/portal-integration-*.yaml` and manifest payloads from `charts/metal-api/files/`.
- Override the content bundle by pointing `frontend.content.contentFile` to a custom JSON file bundled with the chart or supplied via `--set-file`.

