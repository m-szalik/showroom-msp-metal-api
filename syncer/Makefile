#!/usr/bin/env bash

SHELL:=/usr/bin/env bash
.DEFAULT_GOAL:=help
ROOT_DIR=$(abspath .)

#
# Go.
#
GO_VERSION ?= 1.24.2

# Use GOPROXY environment variable if set
GOPROXY := $(shell go env GOPROXY)
ifeq ($(GOPROXY),)
GOPROXY := https://proxy.golang.org
endif
export GOPROXY

# Active module mode, as we use go modules to manage dependencies
export GO111MODULE=on

# Hosts running SELinux need :z added to volume mounts
SELINUX_ENABLED := $(shell cat /sys/fs/selinux/enforce 2> /dev/null || echo 0)

ifeq ($(SELINUX_ENABLED),1)
  DOCKER_VOL_OPTS?=:z
endif

VERSION ?= 0.4.1
IMAGE ?= ghcr.io/apeirora/showroom-msp-metal-api-syncer


# Tools.
TOOLS_DIR := hack/tools
TOOLS_BIN_DIR := $(abspath $(TOOLS_DIR)/bin)
GOLANGCI_LINT := $(abspath $(TOOLS_BIN_DIR)/golangci-lint)
GO_APIDIFF := $(TOOLS_BIN_DIR)/go-apidiff
CONTROLLER_GEN := $(TOOLS_BIN_DIR)/controller-gen
GO_INSTALL := ./hack/go-install.sh
GOLANGCI_LINT_EXTRA_ARGS := --timeout 5m


# The help will print out all targets with their descriptions organized bellow their categories. The categories are represented by `##@` and the target descriptions by `##`.
# The awk commands is responsible to read the entire set of makefiles included in this invocation, looking for lines of the file as xyz: ## something, and then pretty-format the target and help. Then, if there's a line with ##@ something, that gets pretty-printed as a category.
# More info over the usage of ANSI control characters for terminal formatting: https://en.wikipedia.org/wiki/ANSI_escape_code#SGR_parameters
# More info over awk command: http://linuxcommand.org/lc3_adv_awk.php
.PHONY: help
help:  ## Display this help
	@awk 'BEGIN {FS = ":.*##"; printf "\nUsage:\n  make \033[36m<target>\033[0m\n"} /^[a-zA-Z_0-9-]+:.*?##/ { printf "  \033[36m%-15s\033[0m %s\n", $$1, $$2 } /^##@/ { printf "\n\033[1m%s\033[0m\n", substr($$0, 5) } ' $(MAKEFILE_LIST)

#CONTROLLER_GEN_VER := v0.19.0
#CONTROLLER_GEN_BIN := controller-gen
#CONTROLLER_GEN := $(abspath $(TOOLS_BIN_DIR)/$(CONTROLLER_GEN_BIN)-$(CONTROLLER_GEN_VER))
#CONTROLLER_GEN_PKG := sigs.k8s.io/controller-tools/cmd/controller-gen
#
#$(CONTROLLER_GEN): # Build controller-gen from tools folder.
#	GOBIN=$(TOOLS_BIN_DIR) $(GO_INSTALL) $(CONTROLLER_GEN_PKG) $(CONTROLLER_GEN_BIN) $(CONTROLLER_GEN_VER)

GOLANGCI_LINT_BIN := golangci-lint
GOLANGCI_LINT_VER := $(shell cat ../.github/workflows/ci.yml | grep [[:space:]]version: | sed 's/.*version: //')
GOLANGCI_LINT := $(abspath $(TOOLS_BIN_DIR)/$(GOLANGCI_LINT_BIN)-$(GOLANGCI_LINT_VER))
GOLANGCI_LINT_PKG := github.com/golangci/golangci-lint/cmd/golangci-lint

$(GOLANGCI_LINT): # Build golangci-lint from tools folder.
	GOBIN=$(TOOLS_BIN_DIR) $(GO_INSTALL) $(GOLANGCI_LINT_PKG) $(GOLANGCI_LINT_BIN) $(GOLANGCI_LINT_VER)

GO_MOD_CHECK_DIR := $(abspath ./hack/tools/cmd/gomodcheck)
GO_MOD_CHECK := $(abspath $(TOOLS_BIN_DIR)/gomodcheck)
GO_MOD_CHECK_IGNORE := $(abspath .gomodcheck.yaml)
.PHONY: $(GO_MOD_CHECK)
$(GO_MOD_CHECK): # Build gomodcheck.
	go build -C $(GO_MOD_CHECK_DIR) -o $(GO_MOD_CHECK)

## --------------------------------------
## Linting
## --------------------------------------

.PHONY: lint
lint: WHAT ?=
lint: $(GOLANGCI_LINT) ## Lint codebase.
	@if [ -n "$(WHAT)" ]; then \
		$(GOLANGCI_LINT) run -v $(GOLANGCI_LINT_EXTRA_ARGS) $(WHAT); \
	else \
	  for MOD in . $$(git ls-files '**/go.mod' | sed 's,/go.mod,,'); do \
		(cd $$MOD; $(GOLANGCI_LINT) run -v $(GOLANGCI_LINT_EXTRA_ARGS)); \
	  done; \
	fi

.PHONY: lint-fix
lint-fix: $(GOLANGCI_LINT) ## Lint the codebase and run auto-fixers if supported by the linter.
	GOLANGCI_LINT_EXTRA_ARGS=--fix $(MAKE) lint

.PHONY: imports
imports: WHAT ?=
imports: $(GOLANGCI_LINT) ## Format module imports.
	@if [ -n "$(WHAT)" ]; then \
		$(GOLANGCI_LINT) fmt --enable gci -c $(ROOT_DIR)/.golangci.yml $(WHAT); \
	else \
	  for MOD in . $$(git ls-files '**/go.mod' | sed 's,/go.mod,,'); do \
		(cd $$MOD; $(GOLANGCI_LINT) fmt --enable gci -c $(ROOT_DIR)/.golangci.yml); \
	  done; \
	fi

## --------------------------------------
## Generate
## --------------------------------------

.PHONY: modules
modules: WHAT ?=
modules: ## Runs go mod to ensure modules are up to date.
	@if [ -n "$(WHAT)" ]; then \
		(cd $(WHAT); go mod tidy); \
	else \
	  for MOD in . $$(git ls-files '**/go.mod' | sed 's,/go.mod,,'); do \
		(cd $$MOD; go mod tidy); \
	  done; \
	fi

## --------------------------------------
## Cleanup / Verification
## --------------------------------------

.PHONY: clean
clean: ## Cleanup.
	$(GOLANGCI_LINT) cache clean
	$(MAKE) clean-bin

.PHONY: clean-bin
clean-bin: ## Remove all generated binaries.
	rm -rf hack/tools/bin

all: clean modules lint test build-image clean

test:
	go test -v -race -covermode=atomic -coverprofile=cover.out ./...

go-version: ## Print the go version we use to compile our binaries and images.
	@echo $(GO_VERSION)

list-modules: ## Print the Go modules in this repository for GitHub Actions matrix.
	@echo -n '['; \
	git ls-files '**/go.mod' | sed 's,/go.mod,,' | awk 'BEGIN {printf "\"%s\"", "."} NR > 0 {printf ",\"%s\"", $$0}'; \
	echo ']'

build-image:
	@echo "Building image"
	docker build -t $(IMAGE) .

push-image: build-image
	@echo "Tagging and pushing: $(IMAGE):$(VERSION)"
	docker tag $(IMAGE) $(IMAGE):$(VERSION)
	docker push $(IMAGE):$(VERSION)
	docker push $(IMAGE)

release: push-image
	@echo "Preparing syncer release $(VERSION)"
