SHELL:=/usr/bin/env bash
.DEFAULT_GOAL:=all

# List of subdirectories that contain Makefiles to forward targets to.
DIRS ?= syncer
GITHUB_REPOSITORY ?= apeirora/showroom-msp-metal-api
GITHUB_REPOSITORY_OWNER ?= apeirora
OCM_REPOSITORY ?= oci://ghcr.io/apeirora/ocm


.PHONY: all
all:
	@$(MAKE) in-dirs TARGET=all

.PHONY: clean
clean:
	@$(MAKE) in-dirs TARGET=clean
	@rm -fr dist CM_REPOSITORY


.PHONY: version_validation
version_validation:
	@if [ -z "$(strip $(VERSION))" ]; then \
	  echo "ERROR: VERSION is required (e.g., make release VERSION=1.2.3)"; \
	  exit 2; \
	fi

# Run a given TARGET in all DIRS.
.PHONY: in-dirs
in-dirs:
	@set -e; \
	for d in $(DIRS); do \
	  if [ -f $$d/Makefile ]; then \
	    echo "==> $$d: $(TARGET)"; \
	    $(MAKE) -C $$d $(TARGET); \
	  else \
	    echo "Skipping $$d (no Makefile)"; \
	  fi; \
	done

.PHONY: ocm
ocm:
	@echo "Building OCM package"
	mkdir -p "dist/ctf"
	ocm add componentversions --create --file dist/ctf .ocm/component-constructor.yaml VERSION="${VERSION}" GITHUB_REPOSITORY="${GITHUB_REPOSITORY}"
	ocm transfer commontransportarchive dist/ctf "$OCM_REPOSITORY" --copy-resources --overwrite


.PHONY: helm-version-update ## Update Helm chart version fields (version, appVersion) to VERSION (strips leading 'v').
helm-version-update: version_validation
	@if [ -z "$(strip $(CHART_FILE))" ]; then \
		echo "ERROR: CHART_FILE is required (e.g., charts/my-chart/Chart.yaml)"; \
		exit 2; \
	fi; \
	if [ ! -f "$(CHART_FILE)" ]; then \
		echo "ERROR: Helm chart file not found at $(CHART_FILE)"; \
		exit 1; \
	fi; \
	sed -i.bak -E "s/^version:[[:space:]]*.*/version: $(VERSION)/" "$(CHART_FILE)"; \
	sed -i.bak -E "s/^appVersion:[[:space:]]*.*/appVersion: \"$(VERSION)\"/" "$(CHART_FILE)"; \
	rm -f "$(CHART_FILE).bak"; \
	echo "Updated $(CHART_FILE):"; \
	grep -E "^(version:|appVersion:)" "$(CHART_FILE)";

helm-build-and-publish:
	@if [ -z "$(strip $(CHART_FILE))" ]; then \
		echo "ERROR: CHART_FILE is required (e.g., charts/my-chart/Chart.yaml)"; \
		exit 2; \
	fi; \
	CHART_DIR="$$(dirname "$(CHART_FILE)")"; \
	pkg_out="$$(helm package "$$CHART_DIR" --destination "$$CHART_DIR")"; \
	archive="$$(echo "$$pkg_out" | awk '{print $$NF}')"; \
	echo "Archive: $$archive pushing to oci://ghcr.io/$$GITHUB_REPOSITORY/charts"; \
	helm push "$$archive" oci://ghcr.io/$(GITHUB_REPOSITORY)/charts

helm-release: helm-version-update helm-build-and-publish


# Release across subdirectories; require VERSION
.PHONY: release
release: version_validation
	@$(MAKE) helm-release VERSION=${VERSION} CHART_FILE=charts/showroom-msp-metal-api-syncer/Chart.yaml
	@$(MAKE) helm-release VERSION=${VERSION} CHART_FILE=charts/metal-api/Chart.yaml
	@$(MAKE) helm-release VERSION=${VERSION} CHART_FILE=charts/showroom-redfish-mock-server/Chart.yaml
	@$(MAKE) in-dirs TARGET=release
	@$(MAKE) ocm
