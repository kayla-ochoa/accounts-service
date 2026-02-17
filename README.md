# Accounts API (Orchestrator) — README.md

## Overview

The Accounts API both:

1. Runs as a service
2. Orchestrates the entire demo environment

It manages:

* Kind cluster creation
* ingress-nginx installation
* Postman Insights agent installation
* Deployment of identity, catalog, and accounts services
* Traffic simulation
* Full teardown

---

## Architecture

Services:

* identity-api (namespace: `identity`)
* catalog-api (namespace: `catalog`)
* accounts-api (namespace: `accounts`)

Infrastructure:

* ingress-nginx
* Postman Insights Agent (DaemonSet)

Ingress routes:

* `/identity`
* `/accounts`
* `/catalog`

---

## Prerequisites

* Docker
* kind
* kubectl
* curl
* python3
* Postman account with Insights enabled

---

## Manual Setup in Postman

1. Create three Insights projects:

   * Identity
   * Accounts
   * Catalog
2. Copy each `svc_xxxxxxxxxx` Project ID
3. Create a Postman API key

Optional:

* Enable Repro Mode
* Configure redactions
* Set up alerts

---

## Required Environment Variables

```bash
export POSTMAN_API_KEY="PMAK_xxxxx"

export IDENTITY_PROJECT_ID="svc_identity"
export ACCOUNTS_PROJECT_ID="svc_accounts"
export CATALOG_PROJECT_ID="svc_catalog"

export IDENTITY_WORKSPACE_ID="uuid-identity"
export ACCOUNTS_WORKSPACE_ID="uuid-accounts"
export CATALOG_WORKSPACE_ID="uuid-catalog"

export POSTMAN_SYSTEM_ENV="uuid-system-env"

```

---

## Run the Demo

```bash
./scripts/run-demo.sh
```

This will:

* Create Kind cluster
* Install ingress-nginx
* Install Insights agent
* Build and deploy all three services
* Apply ingress
* Validate health checks

---

## Traffic Simulation

```bash
./scripts/simulate-traffic.sh --verbose --slow
```

Example output:

```
✓ POST /identity/users (18ms)
✗ POST /accounts/accounts/onboard (400, 15ms)
```

---

## Teardown

Dry run:

```bash
./scripts/teardown-demo.sh --dry-run
```

Full teardown:

```bash
./scripts/teardown-demo.sh
```

Delete cluster:

```bash
DELETE_CLUSTER=1 ./scripts/teardown-demo.sh
```

---

## Ownership Model

Identity and Catalog repos own:

* Application code
* Dockerfile
* Deployment + Service

Accounts repo owns:

* Cluster setup
* Ingress
* Insights agent
* Traffic simulation
* Teardown
