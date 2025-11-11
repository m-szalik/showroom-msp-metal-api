package controller

import (
	"context"
	"fmt"
	"time"

	"github.com/apeirora/showroom-msp-metal-api-sync-agent/internal/clusterregistry"
	metalv1 "github.com/ironcore-dev/metal-operator/api/v1alpha1"
	"github.com/m-szalik/goutils"
	"github.com/pkg/errors"

	corev1 "k8s.io/api/core/v1"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	"k8s.io/client-go/tools/reference"

	ctrl "sigs.k8s.io/controller-runtime"
	"sigs.k8s.io/controller-runtime/pkg/client"
	"sigs.k8s.io/controller-runtime/pkg/controller/controllerutil"
	ctrllog "sigs.k8s.io/controller-runtime/pkg/log"
	"sigs.k8s.io/controller-runtime/pkg/reconcile"

	mcmanager "sigs.k8s.io/multicluster-runtime/pkg/manager"
	mcreconcile "sigs.k8s.io/multicluster-runtime/pkg/reconcile"
)

// ServerClaimControllerName is the controller name used for logging and finalizers
// related to ServerClaim reconciliation.
const (
	ServerClaimControllerName = "msp-metal-api-sync-agent-serverclaim-controller"
)

// ServerClaimController reconciles metalv1.ServerClaim resources in KCP clusters
// and manages binding/unbinding them to Servers from regular clusters.
type ServerClaimController struct {
	*baseController
}

// Reconcile implements the reconciliation loop for ServerClaim resources in KCP clusters.
// It validates claim exclusivity, creates or updates claimed Server mirrors, and
// updates the ServerClaim status accordingly.
func (c *ServerClaimController) Reconcile(ctx context.Context, req mcreconcile.Request) (ctrl.Result, error) {
	if !clusterregistry.IsKCP(req.ClusterName) {
		return ctrl.Result{}, nil // ignore
	}
	cl, err := c.mgr.GetCluster(ctx, req.ClusterName)
	if err != nil {
		return reconcile.Result{}, err
	}
	serverClaim := &metalv1.ServerClaim{}
	clClient := cl.GetClient()
	if err := clClient.Get(ctx, req.Request.NamespacedName, serverClaim); err != nil {
		return reconcile.Result{}, ignoreNotFound(err)
	}
	if serverClaim.ObjectMeta.DeletionTimestamp != nil && !serverClaim.ObjectMeta.DeletionTimestamp.IsZero() {
		err = c.serverClaimCleanup(ctx, serverClaim)
		if err != nil {
			c.entryLog.Error(err, "error during cleanup for %s", serverClaim)
			return ctrl.Result{}, err
		}
		controllerutil.RemoveFinalizer(serverClaim, ServerClaimControllerName)
		err = clClient.Update(ctx, serverClaim)
		return ctrl.Result{RequeueAfter: 100 * time.Millisecond}, err
	}
	if !controllerutil.ContainsFinalizer(serverClaim, ServerClaimControllerName) {
		controllerutil.AddFinalizer(serverClaim, ServerClaimControllerName)
		err = clClient.Update(ctx, serverClaim)
		return ctrl.Result{RequeueAfter: 100 * time.Millisecond}, err
	}
	if serverClaim.Status.Phase == "" {
		serverClaim.Status.Phase = metalv1.PhaseUnbound
		err = clClient.Status().Update(ctx, serverClaim)
		return ctrl.Result{RequeueAfter: 100 * time.Millisecond}, err
	}
	if serverClaim.Status.Phase == metalv1.PhaseBound {
		// check if status should be updated
		err = c.setServerPower(ctx, req, serverClaim.Spec.ServerRef, serverClaim.Spec.Power)
		if err != nil {
			return ctrl.Result{}, errors.Wrapf(err, "cannot update power state - updated serverClaim")
		}
		return ctrl.Result{}, nil
	}

	// claiming process - validation
	allServerClaims, err := findAllServerClaimsForServer(ctx, clClient, serverClaim.Spec.ServerRef.Name)
	if err != nil {
		return ctrl.Result{}, err
	}
	serverClaimsCount := goutils.CountMatch(allServerClaims, func(element metalv1.ServerClaim) bool {
		return element.ObjectMeta.UID != serverClaim.ObjectMeta.UID && element.Status.Phase == metalv1.PhaseBound
	})
	if serverClaimsCount > 0 {
		return ctrl.Result{}, fmt.Errorf("server %s is claimed by somebody else", serverClaim.Spec.ServerRef.Name)
	}

	serverClusterName, serverToClaim, err := c.findClusterAndServerByServerName(ctx, serverClaim.Spec.ServerRef.Name)
	if err != nil {
		return ctrl.Result{}, err
	}
	if serverClusterName == "" || serverToClaim == nil {
		return ctrl.Result{}, fmt.Errorf("cannot find cluster for server '%s', likly it does not exists", serverClaim.Spec.ServerRef.Name)
	}
	serverClaimRef, err := reference.GetReference(MetalScheme, serverClaim)
	if err != nil {
		return ctrl.Result{}, err
	}

	// claiming process - assignment
	serverToClaimCopy := serverToClaim.DeepCopy()
	serverToClaimCopy.Spec.ServerClaimRef = serverClaimRef
	_server := &metalv1.Server{}
	err = clClient.Get(ctx, client.ObjectKeyFromObject(serverToClaimCopy), _server)
	if err != nil && apierrors.IsNotFound(err) {
		err = clClient.Create(ctx, serverToClaimCopy)
		if err != nil {
			return ctrl.Result{}, err
		}
	}

	serverClaim.Status.Phase = metalv1.PhaseBound
	err = clClient.Status().Update(ctx, serverClaim)
	if err != nil {
		return ctrl.Result{}, err
	}
	err = c.setServerPower(ctx, req, serverClaim.Spec.ServerRef, serverClaim.Spec.Power)
	if err != nil {
		return ctrl.Result{}, errors.Wrapf(err, "cannot update power state - new serverClaim")
	}
	fmt.Printf("ServerClaim %s created/updated namespace:%s, cluster:%s\n", req.Name, req.Namespace, req.ClusterName)
	if serverClaim.Status.Phase != metalv1.PhaseBound {
		return ctrl.Result{RequeueAfter: 1 * time.Minute}, nil
	}
	return ctrl.Result{}, nil
}

func findAllServerClaimsForServer(ctx context.Context, clClient client.Client, serverName string) ([]metalv1.ServerClaim, error) {
	list := make([]metalv1.ServerClaim, 0)
	listResource := metalv1.ServerClaimList{}
	err := clClient.List(ctx, &listResource)
	if err != nil {
		return nil, err
	}
	for _, sc := range listResource.Items {
		if sc.Spec.ServerRef.Name == serverName {
			list = append(list, sc)
		}
	}
	return list, nil
}

func (c *ServerClaimController) serverClaimCleanup(ctx context.Context, serverClaim *metalv1.ServerClaim) error {
	if serverClaim.Spec.ServerRef == nil {
		return nil
	}
	clusterName, server, err := c.findClusterAndServerByServerName(ctx, serverClaim.Spec.ServerRef.Name)
	if err != nil {
		return err
	}
	if clusterName == "" || server == nil {
		return fmt.Errorf("cannot find server %s", serverClaim.Spec.ServerRef.Name)
	}
	server.Spec.ServerClaimRef = nil
	cl, err := c.mgr.GetCluster(ctx, clusterName)
	if err != nil {
		return err
	}
	server.Spec.ServerClaimRef = nil
	clClient := cl.GetClient()
	err = clClient.Update(ctx, server)
	return err
}

func (c *ServerClaimController) setServerPower(ctx context.Context, req mcreconcile.Request, serverRef *corev1.LocalObjectReference, requestedPowerState metalv1.Power) error {
	if !goutils.SliceContains([]metalv1.Power{metalv1.PowerOn, metalv1.PowerOff}, requestedPowerState) {
		return fmt.Errorf("invalid requested power state '%s'", requestedPowerState)
	}
	servers, err := c.findServers(ctx)
	if err != nil {
		return errors.Wrapf(err, "cannot get servers")
	}
	thisServerList := goutils.Filter[ServerWithClusterName](*servers, func(element ServerWithClusterName) bool {
		return element.Server.Name == serverRef.Name
	})
	if len(thisServerList) > 1 {
		return fmt.Errorf("found more then one server for serverName=%s", serverRef.Name)
	}
	if len(thisServerList) == 0 {
		return fmt.Errorf("no server found for serverName=%s", serverRef.Name)
	}
	ps := metalv1.ServerOffPowerState
	if requestedPowerState == metalv1.PowerOn {
		ps = metalv1.ServerOnPowerState
	}
	jeh := goutils.NewJoinErrorHelper()
	err = c.setServerPowerForServer(ctx, thisServerList[0].ClusterName, thisServerList[0].Server.Name, ps)
	jeh.Append(err)
	err = c.setServerPowerForServer(ctx, req.ClusterName, thisServerList[0].Server.Name, ps)
	jeh.Append(err)
	return jeh.AsError()
}

func (c *ServerClaimController) setServerPowerForServer(ctx context.Context, clusterName, serverName string, powerState metalv1.ServerPowerState) error {
	cl, err := c.getClusterClient(ctx, clusterName)
	if err != nil {
		return err
	}
	server := &metalv1.Server{}
	err = cl.Get(ctx, client.ObjectKey{Name: serverName}, server)
	if err != nil {
		return errors.Wrapf(err, "error finding server %s on cluster %s", serverName, clusterName)
	}
	if string(server.Status.PowerState) != string(powerState) {
		server.Status.PowerState = powerState
		err = cl.Status().Update(ctx, server)
		if err != nil {
			return errors.Wrapf(err, "error updating server.status server %s on cluster %s", serverName, clusterName)
		}
		c.entryLog.Info("Server power state changed", "serverName", serverName, "clusterName", clusterName, "requestedPowerState", powerState)
	}
	return nil
}

// NewServerClaimController constructs a ServerClaimController wired with the given
// multicluster manager and ClusterRegistry.
func NewServerClaimController(mgr mcmanager.Manager, clusterRegistry clusterregistry.ClusterRegistry) *ServerClaimController {
	return &ServerClaimController{
		baseController: &baseController{
			entryLog: ctrllog.Log.WithName(ServerClaimControllerName),
			registry: clusterRegistry,
			mgr:      mgr,
		},
	}
}
