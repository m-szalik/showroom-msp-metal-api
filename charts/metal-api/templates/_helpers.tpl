{{- define "metal-api.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "metal-api.fullname" -}}
{{- if .Values.fullnameOverride -}}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- $name := default .Chart.Name .Values.nameOverride -}}
{{- if contains $name .Release.Name -}}
{{- .Release.Name | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" -}}
{{- end -}}
{{- end -}}
{{- end -}}

{{- define "metal-api.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" -}}
{{- end -}}

{{- define "metal-api.labels" -}}
helm.sh/chart: {{ include "metal-api.chart" . }}
app.kubernetes.io/name: {{ include "metal-api.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- if .Chart.AppVersion }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end -}}

{{- define "metal-api.selectorLabels" -}}
app.kubernetes.io/name: {{ include "metal-api.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end -}}

{{- define "metal-api.frontend.fullname" -}}
{{- printf "%s-frontend" (include "metal-api.fullname" .) | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "metal-api.frontend.serviceAccountName" -}}
{{- if .Values.frontend.serviceAccount.create -}}
{{- default (include "metal-api.frontend.fullname" .) .Values.frontend.serviceAccount.name -}}
{{- else -}}
{{- default "default" .Values.frontend.serviceAccount.name -}}
{{- end -}}
{{- end -}}

{{- define "metal-api.host" -}}
{{- if .Values.frontend.ingress.host -}}
{{- .Values.frontend.ingress.host -}}
{{- else -}}
  {{- $override := .Values.global.hostOverride | default "" -}}
  {{- if $override -}}
    {{- $override -}}
  {{- else -}}
    {{- $sub := .Values.global.subdomain | default "" -}}
    {{- $base := .Values.global.baseDomain | default "" -}}
    {{- if and $sub $base -}}
      {{- printf "%s.%s" $sub $base -}}
    {{- else if $base -}}
      {{- $base -}}
    {{- else if $sub -}}
      {{- $sub -}}
    {{- else -}}
      {{- "" -}}
    {{- end -}}
  {{- end -}}
{{- end -}}
{{- end -}}

{{- define "metal-api.scheme" -}}
{{- default "https" .Values.global.scheme -}}
{{- end -}}

{{- define "metal-api.contentURL" -}}
{{- $host := include "metal-api.host" . -}}
{{- if $host -}}
  {{- printf "%s://%s%s" (include "metal-api.scheme" .) $host (.Values.portalIntegration.contentPath | default "/content.json") -}}
{{- else -}}
  {{- .Values.portalIntegration.contentPath | default "/content.json" -}}
{{- end -}}
{{- end -}}

{{- define "metal-api.contentBundle.configMapName" -}}
{{- printf "%s-content" (include "metal-api.fullname" .) | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "metal-api.contentBundle.volumeName" -}}
{{- printf "%s-content" (include "metal-api.fullname" .) | trunc 63 | trimSuffix "-" -}}
{{- end -}}

