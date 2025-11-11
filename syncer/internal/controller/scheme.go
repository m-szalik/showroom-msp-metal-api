// Package controller contains reconcilers and shared controller utilities
// responsible for synchronizing Server and ServerClaim resources across clusters.
package controller

import (
	metalv1 "github.com/ironcore-dev/metal-operator/api/v1alpha1"
	apisv1alpha1 "github.com/kcp-dev/kcp/sdk/apis/apis/v1alpha1"
	corev1alpha1 "github.com/kcp-dev/kcp/sdk/apis/core/v1alpha1"
	tenancyv1alpha1 "github.com/kcp-dev/kcp/sdk/apis/tenancy/v1alpha1"
	"github.com/m-szalik/goutils"

	"k8s.io/client-go/kubernetes/scheme"
)

// MetalScheme is the shared runtime.Scheme used by controllers in this project.
var MetalScheme = scheme.Scheme

func init() {
	goutils.ExitOnError(metalv1.AddToScheme(MetalScheme), 1)
	goutils.ExitOnError(apisv1alpha1.AddToScheme(MetalScheme), 1)
	goutils.ExitOnError(corev1alpha1.AddToScheme(MetalScheme), 1)
	goutils.ExitOnError(tenancyv1alpha1.AddToScheme(MetalScheme), 1)
}
