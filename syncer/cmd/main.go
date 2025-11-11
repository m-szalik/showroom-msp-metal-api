package main

import (
	"context"
	"errors"

	"github.com/apeirora/showroom-msp-metal-api-sync-agent/internal/clusterregistry"
	"github.com/apeirora/showroom-msp-metal-api-sync-agent/internal/controller"
	"github.com/apeirora/showroom-msp-metal-api-sync-agent/internal/provider_builder"
	metalv1 "github.com/ironcore-dev/metal-operator/api/v1alpha1"
	"github.com/m-szalik/goutils"

	"k8s.io/apimachinery/pkg/api/equality"
	"k8s.io/client-go/rest"

	"sigs.k8s.io/controller-runtime/pkg/cluster"
	"sigs.k8s.io/controller-runtime/pkg/event"
	ctrllog "sigs.k8s.io/controller-runtime/pkg/log"
	"sigs.k8s.io/controller-runtime/pkg/log/zap"
	"sigs.k8s.io/controller-runtime/pkg/manager/signals"
	"sigs.k8s.io/controller-runtime/pkg/predicate"

	mcbuilder "sigs.k8s.io/multicluster-runtime/pkg/builder"
	mcmanager "sigs.k8s.io/multicluster-runtime/pkg/manager"
	mcreconcile "sigs.k8s.io/multicluster-runtime/pkg/reconcile"
	"sigs.k8s.io/multicluster-runtime/providers/multi"
)

var clusterRegistry = clusterregistry.New()

type notifier struct {
	sController *controller.ServerController
}

func (n *notifier) Start(ctx context.Context) error {
	<-ctx.Done()
	return ctx.Err()
}

func (n *notifier) Engage(ctx context.Context, _ string, _ cluster.Cluster) error {
	n.sController.InitSync(ctx)
	return nil
}

func main() {
	ctrllog.SetLogger(zap.New(zap.UseDevMode(true)))
	ctx := signals.SetupSignalHandler()
	mpProvider := multi.New(multi.Options{})
	xcfg := &rest.Config{}
	mgr, err := mcmanager.New(xcfg, mpProvider, mcmanager.Options{
		Scheme: controller.MetalScheme,
	})
	goutils.ExitOnErrorf(err, 1, "unable to create manage")
	err = mgr.Add(clusterRegistry)
	goutils.ExitOnErrorf(err, 2, "unable to add registry")
	mpProvider.SetManager(mgr)
	discoveryOptions := &provider_builder.Options{
		WithKindProvider:  goutils.Env("WITH_KIND_PROVIDER", false),
		WithDefaultClient: goutils.Env("WITH_DEFAULT_CLIENT_PROVIDER", false),
		KcpProviderOptions: &provider_builder.KcpProviderOptions{
			Kubeconfig:          goutils.EnvRequired[string]("KCP_KUBECONFIG"),
			VirtualWorkspaceURL: goutils.EnvRequired[string]("KCP_API_EXPORT_ENDPOINT"),
			ContextName:         "",
		},
	}
	err = provider_builder.DiscoverAndAddProviders(ctx, mpProvider, discoveryOptions)
	goutils.ExitOnErrorf(err, 1, "cannot build discover provider")

	serverClaimController := controller.NewServerClaimController(mgr, clusterRegistry)
	err = mcbuilder.ControllerManagedBy(mgr).
		Named(controller.ServerClaimControllerName).
		For(&metalv1.ServerClaim{}).
		Complete(mcreconcile.Func(serverClaimController.Reconcile))
	goutils.ExitOnErrorf(err, 3, "unable to create controller %s", controller.ServerClaimControllerName)

	serverController := controller.NewServerController(mgr, clusterRegistry)
	err = mcbuilder.ControllerManagedBy(mgr).
		Named(controller.ServerControllerName).
		For(&metalv1.Server{}).
		WithEventFilter(predicate.Funcs{
			UpdateFunc: func(e event.UpdateEvent) bool {
				oldObj := e.ObjectOld.(*metalv1.Server)
				newObj := e.ObjectNew.(*metalv1.Server)
				return !equality.Semantic.DeepEqual(oldObj.Status, newObj.Status)
			}}).
		Complete(mcreconcile.Func(serverController.Reconcile))
	goutils.ExitOnErrorf(err, 3, "unable to create controller %s", controller.ServerControllerName)

	// Run initial sync after caches are started to avoid "the cache is not started" errors.
	err = mgr.Add(&notifier{
		sController: serverController,
	})
	goutils.ExitOnErrorf(err, 3, "unable to add initial sync runnable")

	if err := mgr.Start(ctx); ignoreCanceled(err) != nil {
		goutils.ExitOnErrorf(err, 4, "unable to start")
	}
}

func ignoreCanceled(err error) error {
	if errors.Is(err, context.Canceled) {
		return nil
	}
	return err
}
