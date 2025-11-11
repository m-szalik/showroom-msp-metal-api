# Showroom Metal API 

This project simulates a bear metal servers managed via kubernetes.
It uses [Metal API Operator] to communicate with hardware specialized chip (BMC) via Redfish protocol.
Each BCM is has its own representation in kubernetes resource `bmcs.metal.ironcore.dev` (delivered by Metal API Operator) 

## Components overview
TODO 

## Build and publish OCM package
```shell
make release VERSION=1.2.3
```

## Installation
1. Create kubeconfig secret from KCP cluster in a provider type workspace
```shell
kubectl create secret generic kcp-kubeconfig --from-file=kcp.kubeconfig --dry-run=client -o yaml > kcp-kubeconfig-secret.yaml
```
2. Apply this `kcp-kubeconfig` secret on MSP cluster in a syncer namespace
3. Install [metal-api](charts/metal-api) helm chart on KCP cluster
4. Install **metal-api-operator** on MSP cluster - [Metal Operator](https://github.com/ironcore-dev/metal-operator)
5. Install [showroom-redfish-mock-server](charts/showroom-redfish-mock-server) helm chart on MSP cluster
6. Install [showroom-msp-metal-api-syncer](charts/showroom-msp-metal-api-syncer)` helm chart on MSP cluster
   1. Syncer requires `kcp-kubeconfig-secret` to access KCP
   2. Helm value `KCP.endpoint` must be provided - it can be fetched from KCP  