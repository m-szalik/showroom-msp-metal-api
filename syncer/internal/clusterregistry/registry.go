// Package clusterregistry provides a registry that tracks clusters attached to
// the multicluster manager and offers helpers to filter cluster names.
package clusterregistry

import (
	"context"
	"strings"
	"sync"

	"github.com/go-logr/logr"

	"sigs.k8s.io/controller-runtime/pkg/cluster"
	ctrllog "sigs.k8s.io/controller-runtime/pkg/log"

	"sigs.k8s.io/multicluster-runtime/pkg/manager"
	"sigs.k8s.io/multicluster-runtime/pkg/multicluster"
)

// ClusterRegistry - keep track of cluster names attached to manager.
type ClusterRegistry interface {
	multicluster.Aware
	manager.Runnable

	// ClusterNames - return list of cluster names currently connected to multicluster runtime.
	ClusterNames() []string
	KCPClusterNames() []string
	RegularClusterNames() []string
}

type clusterRegistry struct {
	mu       sync.RWMutex
	clusters map[string]cluster.Cluster
	logg     logr.Logger
}

// New creates a new in-memory ClusterRegistry implementation.
func New() ClusterRegistry {
	return &clusterRegistry{
		clusters: make(map[string]cluster.Cluster),
		logg:     ctrllog.Log.WithName("cluster-registry"),
	}
}

// Engage is called by the multicluster manager when a new cluster is discovered.
func (r *clusterRegistry) Engage(ctx context.Context, name string, cl cluster.Cluster) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if _, ok := r.clusters[name]; !ok {
		r.clusters[name] = cl
		r.logg.Info("Adding cluster", "clusterName", name)
	}
	go func() {
		<-ctx.Done()
		r.mu.Lock()
		delete(r.clusters, name)
		r.mu.Unlock()
	}()
	return nil
}

// Start satisfies controller-runtime’s Runnable; just block on ctx.
func (r *clusterRegistry) Start(ctx context.Context) error {
	<-ctx.Done()
	return ctx.Err()
}

// RegularClusterNames returns names of clusters that are not identified as KCP.
func (r *clusterRegistry) RegularClusterNames() []string {
	return r.clusterNamesFiltered(func(clName string) bool {
		return !IsKCP(clName)
	})
}

// KCPClusterNames returns names of clusters that are identified as KCP.
func (r *clusterRegistry) KCPClusterNames() []string {
	return r.clusterNamesFiltered(IsKCP)
}

// ClusterNames returns the current set of cluster names.
func (r *clusterRegistry) ClusterNames() []string {
	return r.clusterNamesFiltered(func(_ string) bool {
		return true
	})
}

func (r *clusterRegistry) clusterNamesFiltered(filter func(string) bool) []string {
	r.mu.RLock()
	defer r.mu.RUnlock()
	out := make([]string, 0)
	for name := range r.clusters {
		if filter(name) {
			out = append(out, name)
		}
	}
	return out
}

// IsKCP reports whether the given cluster name appears to represent a KCP cluster.
// This is a heuristic based on the substring "kcp" and may be improved in the future.
func IsKCP(clusterName string) bool {
	// TODO something better then that
	return strings.Contains(strings.ToLower(clusterName), "kcp")
}
