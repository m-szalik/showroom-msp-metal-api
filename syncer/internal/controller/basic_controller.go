package controller

import (
	"context"
	"fmt"

	"github.com/apeirora/showroom-msp-metal-api-sync-agent/internal/clusterregistry"
	"github.com/go-logr/logr"
	metalv1 "github.com/ironcore-dev/metal-operator/api/v1alpha1"
	errors2 "sigs.k8s.io/kind/pkg/errors"

	apierrors "k8s.io/apimachinery/pkg/api/errors"

	"sigs.k8s.io/controller-runtime/pkg/client"

	mcmanager "sigs.k8s.io/multicluster-runtime/pkg/manager"
)

// baseController provides shared fields and helpers for specific controllers.
type baseController struct {
	entryLog logr.Logger
	mgr      mcmanager.Manager
	registry clusterregistry.ClusterRegistry
}

// ServerWithClusterName pairs a Server resource with the name of the cluster
// where it currently resides.
type ServerWithClusterName struct {
	Server      metalv1.Server
	ClusterName string
}

func (c *baseController) findServers(ctx context.Context) (*[]ServerWithClusterName, error) {
	var ret []ServerWithClusterName
	for _, clusterName := range c.registry.RegularClusterNames() {
		cl, err := c.mgr.GetCluster(ctx, clusterName)
		if err != nil {
			return nil, err
		}
		// Ensure the cluster's cache is started and synced before listing.
		if !cl.GetCache().WaitForCacheSync(ctx) {
			return nil, fmt.Errorf("timeout waiting for cache sync on cluster %s", clusterName)
		}
		list := &metalv1.ServerList{}
		err = cl.GetClient().List(ctx, list)
		if err != nil {
			return nil, err
		}
		c.entryLog.Info(fmt.Sprintf("There is %d Servers on cluster:%s", len(list.Items), clusterName))
		for _, server := range list.Items {
			ret = append(ret, ServerWithClusterName{
				Server:      server,
				ClusterName: clusterName,
			})
		}
	}
	return &ret, nil
}

func (c *baseController) findClusterAndServerByServerName(ctx context.Context, serverName string) (string, *metalv1.Server, error) {
	c.entryLog.Info(fmt.Sprintf("Searching for server %s", serverName))
	serverList := &metalv1.ServerList{}
	for _, clusterName := range c.registry.RegularClusterNames() {
		cl, err := c.mgr.GetCluster(ctx, clusterName)
		c.entryLog.Info(fmt.Sprintf("Getting all Servers from cluster %s", clusterName))
		if err != nil {
			return "", nil, errors2.Wrapf(err, "cannot obtain client for cluster %s", clusterName)
		}
		// Ensure the cluster's cache is started and synced before listing.
		if !cl.GetCache().WaitForCacheSync(ctx) {
			return "", nil, fmt.Errorf("timeout waiting for cache sync on cluster %s", clusterName)
		}
		err = cl.GetClient().List(ctx, serverList)
		if err != nil {
			return "", nil, err
		}
		for _, server := range serverList.Items {
			c.entryLog.Info(fmt.Sprintf("Server %s found on cluster %s", serverName, clusterName))
			if server.Name == serverName {
				return clusterName, &server, err
			}
		}
	}
	return "", nil, nil
}

func (c *baseController) getClusterClient(ctx context.Context, clusterName string) (client.Client, error) {
	cl, err := c.mgr.GetCluster(ctx, clusterName)
	if err != nil {
		return nil, errors2.Wrapf(err, "cannot get cluster for name=%s", clusterName)
	}
	return cl.GetClient(), nil
}

func ignoreNotFound(err error) error {
	if err == nil || apierrors.IsNotFound(err) {
		return nil
	}
	return err
}

// IsDeleted reports whether the given Kubernetes object has a non-zero
// deletion timestamp, indicating it is being deleted.
func IsDeleted(obj client.Object) bool {
	t := obj.GetDeletionTimestamp()
	return t != nil && !t.IsZero()
}
