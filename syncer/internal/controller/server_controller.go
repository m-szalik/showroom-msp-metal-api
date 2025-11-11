package controller

import (
	"context"
	"fmt"
	"sync"
	"time"

	"github.com/apeirora/showroom-msp-metal-api-sync-agent/internal/clusterregistry"
	metalv1 "github.com/ironcore-dev/metal-operator/api/v1alpha1"
	"github.com/m-szalik/goutils/collector"
	"github.com/pkg/errors"

	apierrors "k8s.io/apimachinery/pkg/api/errors"

	ctrl "sigs.k8s.io/controller-runtime"
	"sigs.k8s.io/controller-runtime/pkg/client"
	"sigs.k8s.io/controller-runtime/pkg/controller/controllerutil"
	ctrllog "sigs.k8s.io/controller-runtime/pkg/log"
	"sigs.k8s.io/controller-runtime/pkg/reconcile"

	mcmanager "sigs.k8s.io/multicluster-runtime/pkg/manager"
	mcreconcile "sigs.k8s.io/multicluster-runtime/pkg/reconcile"
)

// ServerControllerName is the controller name used for logging and finalizers.
const (
	ServerControllerName = "msp-metal-api-sync-agent-server-controller"
)

// ServerController reconciles metalv1.Server resources between regular clusters
// and KCP virtual workspace clusters. It also handles initial synchronization
// when a new KCP cluster joins.
type ServerController struct {
	*baseController
	knownClusters collector.Collection[string]
	lock          sync.Mutex
}

func (c *ServerController) syncServersToKCPCluster(ctx context.Context, servers *[]ServerWithClusterName, clusterName string) error {
	c.entryLog.Info("Sync servers to cluster", "clusterName", clusterName)
	kcpClient, err := c.getClusterClient(ctx, clusterName)
	if err != nil {
		return err
	}
	for _, serverToSync := range *servers {
		if IsDeleted(&serverToSync.Server) {
			continue
		}
		server := &metalv1.Server{}
		err = kcpClient.Get(ctx, client.ObjectKey{Name: serverToSync.Server.Name}, server)
		if ignoreNotFound(err) != nil {
			return err
		}
		if apierrors.IsNotFound(err) {
			c.entryLog.Info("Server not yet on the KCP cluster", "clusterName", clusterName, "serverName", serverToSync.Server.Name, "serverFrom", serverToSync.ClusterName)
			serverCopy := serverToSync.Server.DeepCopy()
			serverCopy.ObjectMeta.ResourceVersion = ""
			serverCopy.ObjectMeta.Finalizers = []string{ServerControllerName}
			err = kcpClient.Create(ctx, serverCopy)
			if err != nil {
				return errors.Wrapf(err, "error syncing sever %s to %s", serverCopy.Name, clusterName)
			}
			err = kcpClient.Status().Update(ctx, serverCopy)
			if err != nil {
				return errors.Wrapf(err, "error syncing sever+server.status %s to %s", serverCopy.Name, clusterName)
			}
		} else { // status only
			c.entryLog.Info("Server already on the KCP cluster", "clusterName", clusterName, "serverName", serverToSync.Server.Name, "serverFrom", serverToSync.ClusterName)
			serverStatusCopy := serverToSync.Server.Status.DeepCopy()
			if serverStatusCopy != nil {
				server.Status = *serverStatusCopy
				err = kcpClient.Status().Update(ctx, server)
				if err != nil {
					return errors.Wrapf(err, "error syncing server.status %s to %s", server.Name, clusterName)
				}
			}
		}
	}
	return nil
}

// InitSync performs an initial synchronization of all Server resources
// from regular clusters to all known KCP clusters.
func (c *ServerController) InitSync(ctx context.Context) {
	allServers, err := c.findServers(ctx)
	if err != nil {
		c.entryLog.Error(err, "initSync - cannot get list of servers")
		return
	}
	for _, clusterName := range c.registry.KCPClusterNames() {
		err := c.syncServersToKCPCluster(ctx, allServers, clusterName)
		if err != nil {
			c.entryLog.Error(err, fmt.Sprintf("initSync for %s failed", clusterName))
		}
	}
}

// Reconcile implements the reconciliation loop for Server resources across
// regular and KCP clusters. It ensures Servers are synchronized and handles
// creation, update, and deletion events.
func (c *ServerController) Reconcile(ctx context.Context, req mcreconcile.Request) (ctrl.Result, error) {
	c.lock.Lock()
	defer c.lock.Unlock()
	isKCPCluster := clusterregistry.IsKCP(req.ClusterName)
	if !c.knownClusters.Contains(req.ClusterName) { // new KCP cluster joined
		c.entryLog.Info("New cluster discovered", "clusterName", req.ClusterName, "isKCP", isKCPCluster)
		allServers, err := c.findServers(ctx)
		if err != nil {
			return reconcile.Result{}, errors.Wrapf(err, "cannot get list of all servers")
		}
		if isKCPCluster {
			err = c.syncServersToKCPCluster(ctx, allServers, req.ClusterName)
			if err != nil {
				return ctrl.Result{}, err
			}
		} else {
			for _, kcpClusterName := range c.registry.KCPClusterNames() {
				err = c.syncServersToKCPCluster(ctx, allServers, kcpClusterName)
				if err != nil {
					return ctrl.Result{}, err
				}
			}
		}
		c.knownClusters.Add(req.ClusterName)
		return reconcile.Result{}, nil
	}

	clClient, err := c.getClusterClient(ctx, req.ClusterName)
	if err != nil {
		return reconcile.Result{}, errors.Wrapf(err, "cannot get client for cluster %s", req.ClusterName)
	}

	server := &metalv1.Server{}
	if err = clClient.Get(ctx, req.Request.NamespacedName, server); err != nil {
		return reconcile.Result{}, ignoreNotFound(err)
	}

	if IsDeleted(server) { // delete request
		if isKCPCluster && server.Spec.ServerClaimRef != nil {
			return reconcile.Result{}, fmt.Errorf("cannot remove server that is claimed")
		}
		if !isKCPCluster {
			err = c.deleteMSPServerRemovedCleanup(ctx, server)
			if err != nil {
				return reconcile.Result{}, errors.Wrapf(err, "deleteMSPServerRemovedCleanup")
			}
		}
		err = removeFinalizerAndServer(ctx, req.ClusterName, clClient, server)
		if err != nil {
			return ctrl.Result{}, err
		}
		return ctrl.Result{}, nil
	}
	// update
	if !controllerutil.ContainsFinalizer(server, ServerControllerName) {
		requeue, err := addFinalizer(ctx, req.ClusterName, clClient, server)
		if err != nil {
			return reconcile.Result{}, errors.Wrapf(err, "cannot add finalazer to server %s on %s", server.Name, req.ClusterName)
		}
		if requeue {
			return reconcile.Result{RequeueAfter: 100 * time.Millisecond}, nil
		}
		return reconcile.Result{}, nil
	}
	if !isKCPCluster { // new server added on MSP side
		serverToSync := []ServerWithClusterName{
			{
				Server:      *server,
				ClusterName: req.ClusterName,
			},
		}
		for _, clusterName := range c.registry.KCPClusterNames() {
			err = c.syncServersToKCPCluster(ctx, &serverToSync, clusterName)
			if err != nil {
				return reconcile.Result{}, errors.Wrapf(err, "cannot update server %s->%s on kcp cluster %s", req.ClusterName, server.Name, clusterName)
			}
		}
	}
	return ctrl.Result{}, nil
}

func (c *ServerController) deleteMSPServerRemovedCleanup(ctx context.Context, removedServer *metalv1.Server) error {
	// remove all server on kcp
	for _, clusterName := range c.registry.KCPClusterNames() {
		cl, err := c.getClusterClient(ctx, clusterName)
		if err != nil {
			return errors.Wrapf(err, "cannot get cluster-client for cluster %s", clusterName)
		}
		// remove all server claims
		serverClaimList := &metalv1.ServerClaimList{}
		err = cl.List(ctx, serverClaimList)
		if err != nil {
			return errors.Wrapf(err, "cannot get list of ServerClaims for cluster %s", clusterName)
		}
		for _, serverClaim := range serverClaimList.Items {
			if serverClaim.Spec.ServerRef != nil && serverClaim.Spec.ServerRef.Name == removedServer.Name {
				err = cl.Delete(ctx, &serverClaim)
				if err != nil {
					return errors.Wrapf(err, "cannot remove serverclaim %s/%s from cluster %s", serverClaim.Namespace, serverClaim.Name, clusterName)
				}
				c.entryLog.Info(fmt.Sprintf("ServerClaim %s/%s removed form KCP cluster %s", serverClaim.Namespace, serverClaim.Name, clusterName))
			}
		}
		// remove server from KCP
		server := &metalv1.Server{}
		err = cl.Get(ctx, client.ObjectKey{Namespace: removedServer.Namespace, Name: removedServer.Name}, server)
		if err != nil {
			if apierrors.IsNotFound(err) {
				continue
			}
			return errors.Wrapf(err, "cannot get sever %s from cluster %s", removedServer.Name, clusterName)
		}
		err = removeFinalizerAndServer(ctx, clusterName, cl, server)
		if err != nil {
			return err
		}
	}
	return nil
}

func removeFinalizerAndServer(ctx context.Context, clusterName string, clClient client.Client, server *metalv1.Server) error {
	if controllerutil.ContainsFinalizer(server, ServerControllerName) {
		refreshedServer := &metalv1.Server{}
		err := clClient.Get(ctx, client.ObjectKey{Name: server.Name}, refreshedServer)
		if err != nil {
			if apierrors.IsNotFound(err) {
				return nil
			}
			return errors.Wrapf(err, "cannot refresh server")
		}
		if controllerutil.ContainsFinalizer(refreshedServer, ServerControllerName) {
			controllerutil.RemoveFinalizer(refreshedServer, ServerControllerName)
			err = clClient.Update(ctx, refreshedServer)
			if err != nil {
				return errors.Wrapf(err, "cannot update after removing finalazer from server %s on %s", refreshedServer.Name, clusterName)
			}
		}
		err = clClient.Delete(ctx, refreshedServer)
		if ignoreNotFound(err) != nil {
			return errors.Wrapf(err, "cannot delete server %s on %s", refreshedServer.Name, clusterName)
		}
	}
	return nil
}

func addFinalizer(ctx context.Context, clusterName string, clClient client.Client, server *metalv1.Server) (bool, error) {
	if !controllerutil.ContainsFinalizer(server, ServerControllerName) && server.ObjectMeta.DeletionTimestamp != nil && !server.ObjectMeta.DeletionTimestamp.IsZero() {
		refreshedServer := &metalv1.Server{}
		err := clClient.Get(ctx, client.ObjectKey{Name: server.Name}, refreshedServer)
		if err != nil {
			if apierrors.IsNotFound(err) {
				return false, nil
			}
			return false, errors.Wrapf(err, "cannot refresh server")
		}
		if refreshedServer.ObjectMeta.DeletionTimestamp != nil && !refreshedServer.ObjectMeta.DeletionTimestamp.IsZero() {
			return false, nil
		}
		if !controllerutil.ContainsFinalizer(refreshedServer, ServerControllerName) {
			controllerutil.AddFinalizer(refreshedServer, ServerControllerName)
			err = clClient.Update(ctx, refreshedServer)
			if err != nil {
				return false, errors.Wrapf(err, "cannot update after adding finalazer from server %s on %s", refreshedServer.Name, clusterName)
			}
			return true, nil
		}
	}
	return false, nil
}

// NewServerController constructs a ServerController wired with the given
// multicluster manager and ClusterRegistry.
func NewServerController(mgr mcmanager.Manager, clusterRegistry clusterregistry.ClusterRegistry) *ServerController {
	return &ServerController{
		baseController: &baseController{
			entryLog: ctrllog.Log.WithName(ServerControllerName),
			registry: clusterRegistry,
			mgr:      mgr,
		},
		knownClusters: collector.NewSet[string](),
	}
}
