// Package provider_builder contains helpers to discover and add providers to
// the multicluster manager used by this project.
//
//revive:disable:var-naming // package name uses underscore to match existing repository layout.
package provider_builder

import (
	"context"
	"fmt"
	"os"

	"github.com/apeirora/showroom-msp-metal-api-sync-agent/internal/controller"
	"github.com/kcp-dev/multicluster-provider/apiexport"
	"github.com/pkg/errors"

	"k8s.io/client-go/rest"
	"k8s.io/client-go/tools/clientcmd"

	"sigs.k8s.io/controller-runtime/pkg/client/config"
	"sigs.k8s.io/controller-runtime/pkg/cluster"
	crmanager "sigs.k8s.io/controller-runtime/pkg/manager"

	multiclusterruntime "sigs.k8s.io/multicluster-runtime"
	"sigs.k8s.io/multicluster-runtime/providers/kind"
	"sigs.k8s.io/multicluster-runtime/providers/kubeconfig"
	"sigs.k8s.io/multicluster-runtime/providers/multi"
	singlep "sigs.k8s.io/multicluster-runtime/providers/single"
)

// KcpProviderOptions holds configuration required to connect to a KCP virtual
// workspace and register the APIExport-backed provider.
type KcpProviderOptions struct {
	Kubeconfig          string
	VirtualWorkspaceURL string
	ContextName         string
}

// Options controls which providers are discovered and added to the manager.
type Options struct {
	WithKindProvider   bool
	KcpProviderOptions *KcpProviderOptions
	WithKubeConfig     bool
	WithDefaultClient  bool
}

// DiscoverAndAddProviders discovers providers based on the given options and
// registers them with the provided multi-provider and manager.
func DiscoverAndAddProviders(ctx context.Context, mpProvider *multi.Provider, options *Options) error {
	if options.WithKubeConfig {
		kubeProvider := kubeconfig.New(kubeconfig.Options{
			KubeconfigSecretLabel: "kubeconfig",
		})
		err := mpProvider.AddProvider(ctx, "kubeconfig", kubeProvider, func(ctx context.Context, manager multiclusterruntime.Manager) error {
			return kubeProvider.SetupWithManager(ctx, manager)
		})
		if err != nil {
			return errors.Wrap(err, "error adding kubeconfig provider")
		}
	}
	if options.KcpProviderOptions != nil {
		cfg, err := loadConfigFromFile(options.KcpProviderOptions.Kubeconfig, options.KcpProviderOptions.ContextName)
		if err != nil {
			return fmt.Errorf("unable to get kcp context for contextName=%s:: %w", options.KcpProviderOptions.ContextName, err)
		}
		cfg = rest.CopyConfig(cfg)
		if options.KcpProviderOptions.VirtualWorkspaceURL == "" {
			return errors.Errorf("virtualWorkspaceURL must be set")
		}
		cfg.Host = options.KcpProviderOptions.VirtualWorkspaceURL

		kcpProvider, err := apiexport.New(cfg, apiexport.Options{
			Scheme: controller.MetalScheme,
		})
		if err != nil {
			return errors.Wrap(err, "error creating kcp provider")
		}
		err = mpProvider.AddProvider(ctx, "kcp", kcpProvider, func(ctx context.Context, manager multiclusterruntime.Manager) error {
			err := kcpProvider.Run(ctx, manager)
			return err
		})
		if err != nil {
			return errors.Wrap(err, "error adding kcp provider")
		}
	}

	if options.WithKindProvider {
		kindProvider := kind.New()
		err := mpProvider.AddProvider(ctx, "kind", kindProvider, func(ctx context.Context, manager multiclusterruntime.Manager) error {
			return kindProvider.Run(ctx, manager)
		})
		if err != nil {
			return errors.Wrap(err, "error adding kind provider")
		}
	}

	if options.WithDefaultClient {
		k8sConfig, err := config.GetConfig()
		if err != nil {
			return errors.Wrap(err, "cannot get default k8s config")
		}
		cl, err := cluster.New(k8sConfig)
		if err != nil {
			return errors.Wrap(err, "cannot get default k8s config, error during Cluster creation")
		}
		singleProvider := singlep.New("default", cl)
		err = mpProvider.AddProvider(ctx, "default", singleProvider, func(ctx context.Context, mgr multiclusterruntime.Manager) error {
			if err := mgr.GetLocalManager().Add(crmanager.RunnableFunc(func(rctx context.Context) error {
				return cl.Start(rctx)
			})); err != nil {
				return errors.Wrap(err, "unable to add starter for default cluster")
			}
			return singleProvider.Run(ctx, mgr)
		})
		if err != nil {
			return errors.Wrap(err, "error adding default provider")
		}
	}
	return nil
}

func loadConfigFromFile(configFile string, context string) (*rest.Config, error) {
	stat, err := os.Stat(configFile)
	if err != nil {
		return nil, errors.Wrapf(err, "cannot load k8s config from %s", configFile)
	}
	if stat.IsDir() {
		return nil, errors.Wrapf(errors.New("is a directory not a file"), "cannot load k8s config from %s", configFile)
	}
	loader := clientcmd.NewDefaultClientConfigLoadingRules()
	loader.ExplicitPath = configFile
	loader.Precedence = append(loader.Precedence, configFile)
	return clientcmd.NewNonInteractiveDeferredLoadingClientConfig(
		loader,
		&clientcmd.ConfigOverrides{
			CurrentContext: context,
		}).ClientConfig()
}
