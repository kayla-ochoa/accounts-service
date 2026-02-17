#!/usr/bin/env bash
set -euo pipefail

CLUSTER_NAME="${CLUSTER_NAME:-demo}"

# repo locations (assume siblings by default)
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PARENT_DIR="$(cd "${ROOT_DIR}/.." && pwd)"

IDENTITY_DIR="${IDENTITY_DIR:-${PARENT_DIR}/identity-service}"
CATALOG_DIR="${CATALOG_DIR:-${PARENT_DIR}/catalog-service}"
ACCOUNTS_DIR="${ACCOUNTS_DIR:-${ROOT_DIR}}"

# required Postman vars
POSTMAN_API_KEY="${POSTMAN_API_KEY:-}"
IDENTITY_PROJECT_ID="${IDENTITY_PROJECT_ID:-}"
ACCOUNTS_PROJECT_ID="${ACCOUNTS_PROJECT_ID:-}"
CATALOG_PROJECT_ID="${CATALOG_PROJECT_ID:-}"

if [[ -z "${POSTMAN_API_KEY}" || -z "${IDENTITY_PROJECT_ID}" || -z "${ACCOUNTS_PROJECT_ID}" || -z "${CATALOG_PROJECT_ID}" ]]; then
  echo "ERROR: missing required env vars."
  echo "Required:"
  echo "  POSTMAN_API_KEY"
  echo "  IDENTITY_PROJECT_ID"
  echo "  ACCOUNTS_PROJECT_ID"
  echo "  CATALOG_PROJECT_ID"
  exit 1
fi

# tools
for cmd in kind kubectl docker curl; do
  command -v "$cmd" >/dev/null 2>&1 || { echo "ERROR: missing $cmd"; exit 1; }
done

echo "🔧 Using repos:"
echo "  identity: ${IDENTITY_DIR}"
echo "  catalog : ${CATALOG_DIR}"
echo "  accounts: ${ACCOUNTS_DIR}"
echo

#####################################
# 1) Create kind cluster (if needed)
#####################################
if kind get clusters | grep -qx "${CLUSTER_NAME}"; then
  echo "✅ Kind cluster '${CLUSTER_NAME}' already exists"
else
  echo "🐳 Creating kind cluster '${CLUSTER_NAME}'"
  # expects accounts-api/k8s/kind-config.yaml (optional). If you don’t have it, remove --config.
  if [[ -f "${ACCOUNTS_DIR}/k8s/kind-config.yaml" ]]; then
    kind create cluster --name "${CLUSTER_NAME}" --config "${ACCOUNTS_DIR}/k8s/kind-config.yaml"
  else
    kind create cluster --name "${CLUSTER_NAME}"
  fi
fi

kind export kubeconfig --name "${CLUSTER_NAME}" >/dev/null 2>&1 || true
kubectl config use-context "kind-${CLUSTER_NAME}" >/dev/null 2>&1 || true

echo "🔎 Cluster check:"
kubectl get nodes

#####################################
# 2) Install ingress-nginx (idempotent)
#####################################
echo "🌐 Ensuring ingress-nginx is installed..."
if kubectl get ns ingress-nginx >/dev/null 2>&1; then
  echo "✅ ingress-nginx namespace exists"
else
  kubectl apply --validate=false -f https://raw.githubusercontent.com/kubernetes/ingress-nginx/main/deploy/static/provider/kind/deploy.yaml
fi

echo "⏳ Waiting for ingress-nginx controller..."
kubectl -n ingress-nginx rollout status deployment/ingress-nginx-controller --timeout=240s

#####################################
# 3) Build images + load into kind
#####################################
echo "🏗️  Building docker images..."
docker build -t identity-api:dev "${IDENTITY_DIR}"
docker build -t catalog-api:dev  "${CATALOG_DIR}"
docker build -t accounts-api:dev "${ACCOUNTS_DIR}"

echo "📦 Loading images into kind..."
kind load docker-image identity-api:dev --name "${CLUSTER_NAME}"
kind load docker-image catalog-api:dev  --name "${CLUSTER_NAME}"
kind load docker-image accounts-api:dev --name "${CLUSTER_NAME}"

#####################################
# 4) Install Postman Insights Agent DaemonSet
#####################################
echo "🛰️  Installing Postman Insights Agent DaemonSet..."
kubectl apply -f "${ACCOUNTS_DIR}/k8s/postman-insights-agent-daemonset.yaml"

# For kind: toleration to schedule on control-plane if needed (harmless if already allowed)
kubectl -n postman-insights-namespace patch daemonset postman-insights-agent --type='merge' -p '{
  "spec": { "template": { "spec": { "tolerations": [
    { "key": "node-role.kubernetes.io/control-plane", "operator": "Exists", "effect": "NoSchedule" },
    { "key": "node-role.kubernetes.io/master", "operator": "Exists", "effect": "NoSchedule" }
  ]}}}}' >/dev/null 2>&1 || true

echo "⏳ Waiting for Insights agent..."
kubectl -n postman-insights-namespace rollout status daemonset/postman-insights-agent --timeout=240s

#####################################
# 5) Apply service manifests (templated with env vars)
#####################################
tmpdir="$(mktemp -d)"
cleanup() { rm -rf "${tmpdir}"; }
trap cleanup EXIT

render_apply() {
  local in_file="$1"
  local out_file="$2"

  sed \
    -e "s|__POSTMAN_API_KEY__|${POSTMAN_API_KEY}|g" \
    -e "s|__POSTMAN_SYSTEM_ENV__|${POSTMAN_SYSTEM_ENV}|g" \
    -e "s|__IDENTITY_PROJECT_ID__|${IDENTITY_PROJECT_ID}|g" \
    -e "s|__ACCOUNTS_PROJECT_ID__|${ACCOUNTS_PROJECT_ID}|g" \
    -e "s|__CATALOG_PROJECT_ID__|${CATALOG_PROJECT_ID}|g" \
    -e "s|__IDENTITY_WORKSPACE_ID__|${IDENTITY_WORKSPACE_ID}|g" \
    -e "s|__ACCOUNTS_WORKSPACE_ID__|${ACCOUNTS_WORKSPACE_ID}|g" \
    -e "s|__CATALOG_WORKSPACE_ID__|${CATALOG_WORKSPACE_ID}|g" \
    "${in_file}" > "${out_file}"

  kubectl apply -f "${out_file}"
}

echo "🚀 Deploying identity..."
render_apply "${IDENTITY_DIR}/k8s/identity.yaml" "${tmpdir}/identity.yaml"
kubectl -n identity rollout status deployment/identity-api --timeout=180s

echo "🚀 Deploying catalog..."
render_apply "${CATALOG_DIR}/k8s/catalog.yaml" "${tmpdir}/catalog.yaml"
kubectl -n catalog rollout status deployment/catalog-api --timeout=180s

echo "🚀 Deploying accounts..."
render_apply "${ACCOUNTS_DIR}/k8s/accounts.yaml" "${tmpdir}/accounts.yaml"
kubectl -n accounts rollout status deployment/accounts-api --timeout=180s

echo "🔗 Applying ingress bridge services + shared ingress..."
kubectl apply -f "${ACCOUNTS_DIR}/k8s/ingress-bridges.yaml"
kubectl apply -f "${ACCOUNTS_DIR}/k8s/shared-ingress.yaml"

#####################################
# 6) Health checks through ingress
#####################################
echo "⏳ Waiting briefly for ingress routing..."
sleep 2

echo "🩺 Health checks:"
curl -sS -o /dev/null -w "identity: %{http_code}\n" http://localhost/identity/health || true
curl -sS -o /dev/null -w "accounts: %{http_code}\n" http://localhost/accounts/health || true
curl -sS -o /dev/null -w "catalog : %{http_code}\n" http://localhost/catalog/health  || true

echo
echo "✅ Demo environment is up."
echo "Next:"
echo "  1) ./scripts/simulate-traffic.sh --verbose --slow"
echo "  2) Open Insights projects in Postman and wait ~5-10 min for endpoint inference."
