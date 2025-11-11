import React, { useCallback, useMemo, useState, useEffect, useRef } from 'react';
import {
  Toolbar,
  ToolbarSpacer,
  Title,
  Switch,
  Button,
  FlexBox,
  Text,
  AnalyticalTable,
  Label,
  Panel,
  ObjectStatus,
  Link
} from '@ui5/webcomponents-react';

import type { Server, ServerClaim } from './types';
import { ensureLuigiMock } from './luigiMock';

const FALLBACK_USER_ID = 'demo-user';

const normalizeNamespace = (value?: string | null): string | undefined => {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const deriveExplicitNamespace = (context: any, eventNamespaceId?: string): string | undefined => {
  const namespaceFromEvent = normalizeNamespace(eventNamespaceId || context?.namespaceId);
  if (namespaceFromEvent) {
    return namespaceFromEvent;
  }

  const namespaceFromPortal = normalizeNamespace(
    context?.portalContext?.entityContext?.core_platform_mesh_io_account?.namespace ??
      context?.portalContext?.namespace ??
      context?.namespace
  );

  return namespaceFromPortal;
};

type ConfigSource = 'pending' | 'luigi' | 'mock';

interface RuntimeConfig {
  graphqlUrl: string | null;
  token: string | null;
  source: ConfigSource;
  namespace: string | null;
}

const statusToObjectState = (stateText?: string): 'None' | 'Positive' | 'Negative' | 'Critical' | 'Information' => {
  if (!stateText) return 'Information';
  const normalized = stateText.toLowerCase();
  if (normalized.includes('degrad') || normalized.includes('fail') || normalized.includes('error')) return 'Negative';
  if (normalized.includes('warn')) return 'Critical';
  if (normalized.includes('ok') || normalized.includes('ready') || normalized.includes('success')) return 'Information';
  return 'Information';
};

const mapPowerValue = (value?: string) => {
  const normalized = value?.toLowerCase();
  if (normalized === 'on') return { text: 'On', state: 'Positive' as const };
  if (normalized === 'off') return { text: 'Off', state: 'Negative' as const };
  return { text: value ?? 'Unknown', state: 'Information' as const };
};

const formatByteSize = (value?: number | string): string => {
  if (value == null) return '-';
  if (typeof value === 'string') return value;
  const gb = value / (1024 * 1024 * 1024);
  if (Number.isFinite(gb) && gb >= 1) {
    return `${Math.round(gb)} GiB`;
  }
  const mb = value / (1024 * 1024);
  if (Number.isFinite(mb) && mb >= 1) {
    return `${Math.round(mb)} MiB`;
  }
  return `${value} B`;
};

const computeTotalCores = (processors?: Server['status']['processors']): number | null => {
  if (!processors || processors.length === 0) return null;
  let total = 0;
  let hasValue = false;
  for (const processor of processors) {
    if (typeof processor.totalCores === 'number') {
      total += processor.totalCores;
      hasValue = true;
    }
  }
  return hasValue ? total : null;
};

const providerLogoCatalog: Record<string, { src: string; alt: string }> = {
  dell: { src: 'https://upload.wikimedia.org/wikipedia/commons/4/48/Dell_Logo.svg', alt: 'Dell Technologies' },
  supermicro: { src: 'https://upload.wikimedia.org/wikipedia/commons/thumb/1/1d/Super_Micro_Computer_Logo.svg/512px-Super_Micro_Computer_Logo.svg.png', alt: 'Supermicro' },
  lenovo: { src: 'https://upload.wikimedia.org/wikipedia/commons/b/b8/Lenovo_logo_2015.svg', alt: 'Lenovo' },
  hpe: { src: 'https://upload.wikimedia.org/wikipedia/commons/4/46/Hewlett_Packard_Enterprise_logo.svg', alt: 'HPE' },
  hewlettpackard: { src: 'https://upload.wikimedia.org/wikipedia/commons/0/05/HP_logo_2025.svg', alt: 'HP' },
  cisco: { src: 'https://upload.wikimedia.org/wikipedia/commons/6/64/Cisco_logo.svg', alt: 'Cisco' },
  ibm: { src: 'https://upload.wikimedia.org/wikipedia/commons/5/51/IBM_logo.svg', alt: 'IBM' },
  intel: { src: 'https://upload.wikimedia.org/wikipedia/commons/8/85/Intel_logo_2023.svg', alt: 'Intel' },
  amd: { src: 'https://upload.wikimedia.org/wikipedia/commons/7/7c/AMD_Logo.svg', alt: 'AMD' },
  asus: { src: 'https://upload.wikimedia.org/wikipedia/commons/2/2e/ASUS_Logo.svg', alt: 'ASUS' }
};

const resolveProviderLogo = (manufacturer?: string) => {
  if (!manufacturer) return undefined;
  const normalized = manufacturer.toLowerCase().replace(/[^a-z0-9]/g, '');
  const matchedKey = Object.keys(providerLogoCatalog).find((key) => normalized.includes(key));
  return matchedKey ? providerLogoCatalog[matchedKey] : undefined;
};

const renderProviderLogo = (
  logo: { src: string; alt: string } | undefined,
  label: string,
  size = 32
) => {
  const dimension = `${size}px`;
  return (
    <div
      style={{
        width: dimension,
        height: dimension,
        minWidth: dimension,
        minHeight: dimension,
        borderRadius: '50%',
        border: '1px solid var(--sapList_BorderColor)',
        background: 'var(--sapList_Background)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
        flexShrink: 0,
        flexGrow: 0
      }}
    >
      {logo ? (
        <img
          src={logo.src}
          alt={logo.alt ?? label}
          style={{ width: '70%', height: '70%', objectFit: 'contain' }}
        />
      ) : (
        <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--sapTextColor)' }}>
          {label.slice(0, 2).toUpperCase()}
        </span>
      )}
    </div>
  );
};

const summarizeVmStats = (server: Server): string => {
  const totalCores = computeTotalCores(server.status.processors);
  const memory = server.status.totalSystemMemory ? formatByteSize(server.status.totalSystemMemory) : '-';
  const disks = server.status.storages?.flatMap((storage) => storage.drives ?? []) ?? [];
  const totalDiskCapacity = disks.reduce<number>((sum, drive) => {
    if (typeof drive.capacity === 'number') {
      return sum + drive.capacity;
    }
    return sum;
  }, 0);
  const diskSummary = totalDiskCapacity > 0 ? formatByteSize(totalDiskCapacity) : '-';

  const parts = [
    totalCores != null ? `${totalCores} vCPU` : undefined,
    memory !== '-' ? `${memory} RAM` : undefined,
    diskSummary !== '-' ? `${diskSummary} storage` : undefined
  ].filter(Boolean);

  return parts.length > 0 ? parts.join(' · ') : '-';
};

const listConnectivity = (server: Server): string => {
  if (!server.status.networkInterfaces || server.status.networkInterfaces.length === 0) {
    return '-';
  }
  return server.status.networkInterfaces
    .map((iface) => `${iface.name}: ${iface.ip}`)
    .join('\n');
};

type StorageCollection = NonNullable<Server['status']['storages']> extends Array<infer Storage>
  ? Storage
  : never;
type StorageDriveEntry = NonNullable<StorageCollection['drives']> extends Array<infer Drive> ? Drive : never;
type StorageVolumeEntry = NonNullable<StorageCollection['volumes']> extends Array<infer Volume> ? Volume : never;
type StorageEntity = StorageDriveEntry | StorageVolumeEntry;

const describeStorageEntity = (entity: StorageEntity | undefined) => {
  if (!entity) {
    return 'Storage';
  }

  const size =
    typeof entity.capacity === 'number' ? formatByteSize(entity.capacity) : entity.capacity ?? '';

  const typeCandidate =
    ('mediaType' in entity && entity.mediaType) ||
    ('type' in entity && entity.type) ||
    ('raidType' in entity && entity.raidType) ||
    ('volumeUsage' in entity && entity.volumeUsage) ||
    ('model' in entity && entity.model) ||
    entity.name;

  const type = typeof typeCandidate === 'string' && typeCandidate.trim().length > 0 ? typeCandidate : 'Storage';

  return [type, size].filter(Boolean).join(' ');
};

const summarizeStorage = (server: Server): string => {
  const storages = server.status.storages ?? [];
  if (storages.length === 0) {
    return '-';
  }

  const entries = storages.flatMap((storage) => {
    const drives = storage.drives ?? [];
    const volumes = storage.volumes ?? [];

    return [...drives, ...volumes].map((entity) => describeStorageEntity(entity as StorageEntity));
  });

  if (entries.length === 0) {
    return '-';
  }

  const limited = entries.slice(0, 2);
  const truncated = entries.length > 2 ? `${limited.join(', ')}, +${entries.length - 2} more` : limited.join(', ');
  return truncated;
};

const deriveServerState = (server: Server, claim: ServerClaim | undefined): { text: string; state: ReturnType<typeof statusToObjectState> } => {
  const primary = server.status.state ?? server.status.powerState ?? claim?.status?.phase;
  const text = primary ?? 'Unknown';
  return { text, state: statusToObjectState(primary) };
};

const PowerStatusDisplay = ({
  current,
  desired,
  compact = false
}: {
  current?: string;
  desired?: string;
  compact?: boolean;
}) => {
  const currentInfo = mapPowerValue(current);
  const desiredInfo = mapPowerValue(desired);
  const mismatch = Boolean(current && desired && currentInfo.text.toLowerCase() !== desiredInfo.text.toLowerCase());
  const desiredState = mismatch ? ('Critical' as const) : desiredInfo.state;
  const layoutProps = compact
    ? { direction: 'Column' as const, style: { gap: '0.25rem', alignItems: 'flex-start' } }
    : { direction: 'Row' as const, style: { gap: '0.75rem', alignItems: 'flex-start' } };

  return (
    <FlexBox {...layoutProps}>
      <ObjectStatus state={currentInfo.state}>{`Current: ${currentInfo.text}`}</ObjectStatus>
      <ObjectStatus state={desiredState}>
        {mismatch ? `Desired: ${desiredInfo.text} (pending)` : `Desired: ${desiredInfo.text}`}
      </ObjectStatus>
    </FlexBox>
  );
};

export default function App(): JSX.Element {
  const [runtimeConfig, setRuntimeConfig] = useState<RuntimeConfig>({
    graphqlUrl: null,
    token: null,
    source: 'pending',
    namespace: null
  });
  const [currentUserId, setCurrentUserId] = useState<string>(FALLBACK_USER_ID);
  const [servers, setServers] = useState<Server[]>([]);
  const [claims, setClaims] = useState<ServerClaim[]>([]);
  const [onlyClaimed, setOnlyClaimed] = useState<boolean>(false);
  const [selectedServer, setSelectedServer] = useState<Server | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const clientRef = useRef<any>(null);

  const graphqlUrl = runtimeConfig.graphqlUrl ?? undefined;
  const authToken = runtimeConfig.token ?? undefined;
  const activeNamespace = runtimeConfig.namespace;

  useEffect(() => {
    if (!activeNamespace) {
      return;
    }
  }, [activeNamespace]);

  const updateNamespacesFromContext = useCallback((context: any, eventNamespaceId?: string): void => {
    if (!context) return;

    const normalizedAvailable = Array.isArray(context?.portalContext?.namespaces)
      ? (context.portalContext.namespaces as Array<string | null | undefined>)
          .map((ns) => normalizeNamespace(ns))
          .filter((ns): ns is string => Boolean(ns))
      : Array.isArray(context?.namespaces)
      ? (context.namespaces as Array<string | null | undefined>)
          .map((ns) => normalizeNamespace(ns))
          .filter((ns): ns is string => Boolean(ns))
      : [];

    const explicitNamespace = deriveExplicitNamespace(context, eventNamespaceId);

    setRuntimeConfig((prev) => ({
      ...prev,
      namespace: explicitNamespace ?? prev.namespace ?? null
    }));
  }, []);

  useEffect(() => {
    let removeInitListenerId: string | undefined;
    let removeContextListenerId: string | undefined;
    let isMounted = true;

    ensureLuigiMock();

    const applyContext = (
      context?: any,
      source: ConfigSource = 'luigi',
      eventUserId?: string,
      eventNamespaceId?: string
    ) => {
      if (context) {
        setRuntimeConfig((prev) => {
          const nextUrl = context.portalContext?.crdGatewayApiUrl ?? context.graphqlUrl ?? prev.graphqlUrl;
          const nextToken = context.token ?? prev.token ?? null;
          return {
            ...prev,
            graphqlUrl: nextUrl,
            token: nextToken,
            source
          };
        });

        updateNamespacesFromContext(context, eventNamespaceId);
      } else {
        setRuntimeConfig((prev) => ({ ...prev, source }));
      }

      setCurrentUserId((prev) => context?.userInfo?.id ?? eventUserId ?? prev ?? FALLBACK_USER_ID);
    };

    const setupWithClient = (client: any) => {
      if (!client || !isMounted) return;
      clientRef.current = client;
      const source: ConfigSource = client.__isMock ? 'mock' : 'luigi';

      if (typeof client.addInitListener === 'function') {
        const id = client.addInitListener((context: any) => {
          const eventData = typeof client.getEventData === 'function' ? client.getEventData() : undefined;
          applyContext(context, source, eventData?.userId, eventData?.namespaceId ?? context?.namespaceId);
        });
        if (id != null) {
          removeInitListenerId = String(id);
        }
      }

      if (typeof client.addContextUpdateListener === 'function') {
        const ctxId = client.addContextUpdateListener((context: any) => {
          const eventData = typeof client.getEventData === 'function' ? client.getEventData() : undefined;
          applyContext(context, source, eventData?.userId, eventData?.namespaceId ?? context?.namespaceId);
        });
        if (ctxId != null) {
          removeContextListenerId = String(ctxId);
        }
      }

      if (typeof client.getEventData === 'function') {
        const cached = client.getEventData();
        if (cached) {
          applyContext(cached.context, source, cached.userId, cached.namespaceId ?? cached.context?.namespaceId);
        }
      }
    };

    const setupLuigi = async () => {
      try {
        if (typeof window !== 'undefined' && (window as any).LuigiClient) {
          setupWithClient((window as any).LuigiClient);
          return;
        }

        const module = await import('@luigi-project/client');
        if (!isMounted) return;
        const client: any = module?.default ?? module;
        if (client && typeof window !== 'undefined' && !(window as any).LuigiClient) {
          (window as any).LuigiClient = client;
        }
        setupWithClient(client);
      } catch (error) {
        console.warn('[App] Luigi client unavailable', error);
      }
    };

    setupLuigi().catch((error) => {
      console.warn('[App] Failed to initialize Luigi client', error);
    });

    return () => {
      isMounted = false;
      const cleanupClient = clientRef.current;
      if (cleanupClient) {
        if (removeInitListenerId && typeof cleanupClient.removeInitListener === 'function') {
          try {
            cleanupClient.removeInitListener(removeInitListenerId);
          } catch (e) {
            console.debug('[App] Failed to cleanup Luigi init listener', e);
          }
        }
        if (removeContextListenerId && typeof cleanupClient.removeContextUpdateListener === 'function') {
          try {
            cleanupClient.removeContextUpdateListener(removeContextListenerId);
          } catch (e) {
            console.debug('[App] Failed to cleanup Luigi context listener', e);
          }
        }
      }
    };
  }, []);

  const claimByServer = useMemo(() => {
    const map = new Map<string, ServerClaim>();
    for (const claim of claims) {
      const ref = claim.spec.serverRef?.name;
      if (ref) map.set(ref, claim);
    }
    return map;
  }, [claims]);

  const loadData = useCallback(async () => {
    const activeNamespace = runtimeConfig.namespace;
    if (!graphqlUrl || !activeNamespace) {
      return;
    }
    setLoading(true);
    setLoadError(null);
    try {
    const query = `
      query ServersAndClaims($ns: String!) {
        metal_ironcore_dev {
          Servers {
            metadata { name }
            spec { uuid power indicatorLED }
            status {
              manufacturer model sku serialNumber biosVersion totalSystemMemory powerState indicatorLED state
              processors { id manufacturer model architecture instructionSet maxSpeedMHz totalCores totalThreads type }
              networkInterfaces { name macAddress ip }
              storages {
                name state
                drives { name capacity mediaType model type vendor state }
                volumes { name capacity raidType state volumeUsage }
              }
            }
          }
          ServerClaims(namespace: $ns) {
              metadata { name namespace annotations }
            spec { image power serverRef { name } ignitionSecretRef { name } }
            status { phase }
          }
        }
      }
    `;
      const headers: Record<string, string> = {
        'Content-Type': 'application/json'
      };
      if (authToken) {
        headers.Authorization = `Bearer ${authToken}`;
      }
      const resp = await fetch(graphqlUrl, {
          method: 'POST',
        headers,
        body: JSON.stringify({ query, variables: { ns: activeNamespace } })
        });
        if (!resp.ok) throw new Error(`GraphQL HTTP ${resp.status}`);
        const json = await resp.json();
        if (json.errors) throw new Error(json.errors.map((e: any) => e.message).join('; '));
        const payload = json.data?.metal_ironcore_dev;
        const gServers = (payload?.Servers ?? []) as any[];
        const gClaims = (payload?.ServerClaims ?? []) as any[];
      console.debug('GraphQL Servers', gServers);
      console.debug('GraphQL ServerClaims', gClaims);

        const serverNameToClaim = new Map<string, any>();
        for (const c of gClaims) {
          const refName = c?.spec?.serverRef?.name;
          if (refName) serverNameToClaim.set(refName, c);
        }

        const mappedServers: Server[] = gServers.map((gs: any) => {
          const name = gs?.metadata?.name ?? '';
          const claim = serverNameToClaim.get(name);
        const claimOwner = claim?.metadata?.annotations?.['metal.ironcore.dev/owner'] ?? claim?.owner ?? undefined;
          return {
            apiVersion: undefined,
            kind: undefined,
          metadata: { name, annotations: gs?.metadata?.annotations ?? undefined },
            spec: {
              uuid: gs?.spec?.uuid ?? '',
              power: gs?.spec?.power ?? undefined,
              indicatorLED: gs?.spec?.indicatorLED ?? undefined,
              serverClaimRef: claim ? { name: claim?.metadata?.name ?? '' } : null
            },
            status: {
              manufacturer: gs?.status?.manufacturer,
              model: gs?.status?.model,
              powerState: gs?.status?.powerState,
              indicatorLED: gs?.status?.indicatorLED,
              state: gs?.status?.state,
              biosVersion: gs?.status?.biosVersion,
              serialNumber: gs?.status?.serialNumber,
              sku: gs?.status?.sku,
              totalSystemMemory: gs?.status?.totalSystemMemory,
              processors: gs?.status?.processors,
              networkInterfaces: gs?.status?.networkInterfaces,
              storages: gs?.status?.storages
            },
          claimedBy: claimOwner
          };
        });

        const mappedClaims: ServerClaim[] = gClaims.map((gc: any) => ({
          apiVersion: undefined,
          kind: undefined,
        metadata: { name: gc?.metadata?.name ?? '', namespace: gc?.metadata?.namespace ?? undefined, annotations: gc?.metadata?.annotations ?? undefined },
          spec: {
            image: gc?.spec?.image ?? '',
            power: gc?.spec?.power ?? '',
            serverRef: gc?.spec?.serverRef ?? undefined,
            ignitionSecretRef: gc?.spec?.ignitionSecretRef ?? undefined
          },
          status: { phase: gc?.status?.phase },
        owner: gc?.metadata?.annotations?.['metal.ironcore.dev/owner'] ?? undefined
        }));

        const claimNamespaces = mappedClaims
          .map((claim) => normalizeNamespace(claim.metadata.namespace))
          .filter((ns): ns is string => Boolean(ns));
        if (claimNamespaces.length > 0) {
          // setAvailableNamespaces((prev) => { // This line is removed as per the edit hint
          //   const merged = new Set(prev);
          //   claimNamespaces.forEach((ns) => merged.add(ns));
          //   const mergedArray = Array.from(merged);
          //   const unchanged = mergedArray.length === prev.length && mergedArray.every((value, idx) => value === prev[idx]);
          //   return unchanged ? prev : mergedArray;
          // });
        }

        setServers(mappedServers);
        setClaims(mappedClaims);
      setSelectedServer((prev) => {
        if (!prev) return null;
        return mappedServers.find((s) => s.metadata.name === prev.metadata.name) ?? null;
      });
      } catch (e: any) {
        setLoadError(e?.message ?? String(e));
      } finally {
        setLoading(false);
      }
  }, [activeNamespace, authToken, graphqlUrl]);

  useEffect(() => {
    if (!graphqlUrl) return;
    loadData().catch(() => undefined);
  }, [graphqlUrl, loadData]);

  const filteredServers = useMemo(() => {
    if (!onlyClaimed) return servers;
    return servers.filter((s) => {
      const claim = claimByServer.get(s.metadata.name);
      const owner = s.claimedBy ?? claim?.owner ?? claim?.metadata?.annotations?.['metal.ironcore.dev/owner'];
      return owner === currentUserId;
    });
  }, [claimByServer, currentUserId, onlyClaimed, servers]);


  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
      <Toolbar style={{ padding: '0 1rem', gap: '0.75rem', alignItems: 'center' }}>
        <Title level="H4">Available Servers</Title>
        <ToolbarSpacer />
        <Text style={{ marginRight: '0.5rem' }}>Only my servers</Text>
        <Switch
          checked={onlyClaimed}
          onChange={(e: any) => setOnlyClaimed(e.target.checked)}
          accessibleName="Toggle only my servers"
        />
      </Toolbar>

      <div style={{ padding: '1rem', flex: 1, minHeight: 0 }}>
        <div style={{ display: 'grid', gridTemplateColumns: selectedServer ? '1.7fr 1fr' : '1fr', gap: '1rem', height: '100%' }}>
          <div style={{ height: '100%', overflow: 'auto' }}>
            {loadError && (
              <Text style={{ color: 'var(--sapNegativeColor)', display: 'block', marginBottom: '0.5rem' }}>Failed to load: {loadError}</Text>
            )}
            {loading && !loadError && (
              <Text style={{ display: 'block', marginBottom: '0.5rem' }}>Loading servers…</Text>
            )}
            <AnalyticalTable
              data={filteredServers}
              reactTableOptions={{
                getRowId: (row: any, _relativeIndex: number, parent?: { id: string }) =>
                  parent ? `${parent.id}.${row.spec.uuid}` : row.spec.uuid,
                defaultColumn: {
                  minWidth: 160,
                  width: 200,
                  maxWidth: 360
                }
              }}
              onRowClick={(e: any) => setSelectedServer(e.detail.row.original as Server)}
              columns={[
                {
                  Header: 'Name',
                  id: 'name',
                  accessor: (row: any) => row.metadata?.name ?? '-',
                  width: 260,
                  Cell: (instance: any) => {
                    const s: Server = instance.row.original;
                    const power = mapPowerValue(s.status.powerState);
                    return (
                      <FlexBox style={{ gap: '0.5rem', alignItems: 'center' }}>
                        <Link onClick={() => setSelectedServer(s)}>{s.metadata.name}</Link>
                        <ObjectStatus state={power.state}>{power.text}</ObjectStatus>
                      </FlexBox>
                    );
                  }
                },
                {
                  Header: 'State',
                  id: 'state',
                  accessor: (row: any) => row.status?.state ?? row.status?.powerState ?? '-',
                  width: 200,
                  Cell: (instance: any) => {
                    const s: Server = instance.row.original;
                    const claim = claimByServer.get(s.metadata.name);
                    const { text, state } = deriveServerState(s, claim);
                    return <ObjectStatus state={state}>{text}</ObjectStatus>;
                  }
                },
                {
                  Header: 'Provider',
                  id: 'provider',
                  accessor: (row: any) => row.status?.manufacturer ?? '-',
                  width: 280,
                  Cell: (instance: any) => {
                    const s: Server = instance.row.original;
                    const manufacturer = s.status.manufacturer ?? 'Unknown';
                    const model = s.status.model;
                    const logo = resolveProviderLogo(manufacturer);
                    return (
                      <FlexBox style={{ gap: '0.75rem', alignItems: 'center' }}>
                        {renderProviderLogo(logo, manufacturer)}
                        <div>
                          <Text style={{ display: 'block', fontWeight: 600 }}>{manufacturer}</Text>
                          {model ? (
                            <Text style={{ display: 'block', fontSize: '0.75rem', color: 'var(--sapNeutralColor)' }}>{model}</Text>
                          ) : null}
                        </div>
                      </FlexBox>
                    );
                  }
                },
                {
                  Header: 'VM Stats',
                  id: 'vmStats',
                  accessor: (row: any) => summarizeVmStats(row),
                  width: 220,
                  Cell: (instance: any) => {
                    const s: Server = instance.row.original;
                    return <Text>{summarizeVmStats(s)}</Text>;
                  }
                },
                {
                  Header: 'Storage',
                  id: 'storage',
                  accessor: (row: any) => summarizeStorage(row),
                  width: 260,
                  Cell: (instance: any) => {
                    const s: Server = instance.row.original;
                    return <Text style={{ whiteSpace: 'pre-line' }}>{summarizeStorage(s)}</Text>;
                  }
                },
                {
                  Header: 'Connectivity',
                  id: 'connectivity',
                  accessor: (row: any) => listConnectivity(row),
                  width: 260,
                  Cell: (instance: any) => {
                    const s: Server = instance.row.original;
                    return <Text style={{ whiteSpace: 'pre-line' }}>{listConnectivity(s)}</Text>;
                  }
                },
                {
                  Header: 'Owner',
                  id: 'owner',
                  accessor: (row: any) => {
                    const claim = claimByServer.get(row.metadata?.name ?? '');
                    const owner = row.claimedBy ?? claim?.owner ?? claim?.metadata?.annotations?.['metal.ironcore.dev/owner'];
                    return owner ?? '-';
                  },
                  width: 200,
                  Cell: (instance: any) => {
                    const s: Server = instance.row.original;
                    const claim = claimByServer.get(s.metadata.name);
                    const owner = s.claimedBy ?? claim?.owner ?? claim?.metadata?.annotations?.['metal.ironcore.dev/owner'];
                    return <Text>{owner ?? '-'}</Text>;
                  }
                }
              ]}
              noDataText="No servers to display"
              visibleRowCountMode="Auto"
              style={{ width: '100%', overflowX: 'auto' }}
            />
          </div>

          {selectedServer && (
            <div style={{ height: '100%', overflow: 'auto' }}>
              <Panel
                fixed
                header={(
                  <FlexBox style={{ width: '100%', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Title level="H5">{`Details: ${selectedServer.spec.uuid}`}</Title>
                    <Button icon="decline" design="Transparent" tooltip="Close" aria-label="Close" onClick={() => setSelectedServer(null)} />
                  </FlexBox>
                )}
              >
                {(() => {
                  const s = selectedServer;
                  const claim = claimByServer.get(s.metadata.name);
                  const owner = s.claimedBy ?? claim?.owner ?? claim?.metadata?.annotations?.['metal.ironcore.dev/owner'];
                  const { text: stateText, state: stateState } = deriveServerState(s, claim);
                  const manufacturer = s.status.manufacturer ?? 'Unknown';
                  const logo = resolveProviderLogo(manufacturer);
                  const vmStats = summarizeVmStats(s);
                  const connectivity = listConnectivity(s);
                  return (
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '1rem' }}>
                      <FlexBox style={{ gap: '1rem', alignItems: 'center' }}>
                        {renderProviderLogo(logo, manufacturer, 48)}
                        <div style={{ display: 'grid', gap: '0.25rem' }}>
                          <Title level="H5" style={{ margin: 0 }}>{s.metadata.name}</Title>
                          <FlexBox style={{ gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
                            <ObjectStatus state={stateState}>{stateText}</ObjectStatus>
                          </FlexBox>
                          <Text>{manufacturer}{s.status.model ? ` · ${s.status.model}` : ''}</Text>
                        </div>
                      </FlexBox>
                      <Panel headerText="Overview" fixed>
                        <div style={{ display: 'grid', gridTemplateColumns: '160px 1fr', rowGap: '0.25rem' }}>
                          <Label>VM stats</Label><Text>{vmStats}</Text>
                          <Label>Connectivity</Label><Text style={{ whiteSpace: 'pre-line' }}>{connectivity}</Text>
                          <Label>Desired power</Label><Text>{s.spec.power ?? 'Unknown'}</Text>
                          <Label>Current power</Label><Text>{s.status.powerState ?? 'Unknown'}</Text>
                        </div>
                      </Panel>
                      <Panel headerText="Hardware" fixed>
                        <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr', rowGap: '0.25rem' }}>
                          <Label>Model</Label><Text>{s.status.model ?? '-'}</Text>
                          <Label>SKU</Label><Text>{s.status.sku ?? '-'}</Text>
                          <Label>Serial</Label><Text>{s.status.serialNumber ?? '-'}</Text>
                          <Label>BIOS</Label><Text>{s.status.biosVersion ?? '-'}</Text>
                          <Label>Memory</Label><Text>{formatByteSize(s.status.totalSystemMemory)}</Text>
                          <Label>Power</Label>
                          <PowerStatusDisplay current={s.status.powerState} desired={s.spec.power} />
                          <Label>System UUID</Label><Text>{s.spec.systemUUID ?? s.spec.uuid}</Text>
                        </div>
                      </Panel>
                      <Panel headerText="Claim" fixed>
                        <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr', rowGap: '0.25rem' }}>
                          <Label>Owner</Label><Text>{owner ?? '-'}</Text>
                          <Label>Boot Image</Label><Text>{claim?.spec.image ?? '-'}</Text>
                          <Label>Phase</Label><Text>{claim?.status?.phase ?? '-'}</Text>
                          <Label>Ignition</Label><Text>{claim?.spec.ignitionSecretRef?.name ?? '-'}</Text>
                        </div>
                      </Panel>
                      <Panel headerText="Networking" fixed>
                        <div>
                          {(s.status.networkInterfaces?.length ?? 0) === 0 && <Text>-</Text>}
                          {s.status.networkInterfaces?.map((n) => (
                            <div key={n.name} style={{ marginBottom: '0.25rem' }}>
                              <Text>{n.name}: {n.ip} / {n.macAddress}</Text>
                            </div>
                          ))}
                        </div>
                      </Panel>
                      <Panel headerText="Processors" fixed>
                        <div>
                          {(s.status.processors?.length ?? 0) === 0 && <Text>-</Text>}
                          {s.status.processors?.map((p) => (
                            <div key={p.id} style={{ marginBottom: '0.25rem' }}>
                              <Text>
                                {p.id}: {p.model ?? p.manufacturer ?? '-'}{p.totalCores ? `, ${p.totalCores} cores` : ''}
                                {p.totalThreads ? ` / ${p.totalThreads} threads` : ''}
                                {p.maxSpeedMHz ? ` @ ${p.maxSpeedMHz} MHz` : ''}
                              </Text>
                            </div>
                          ))}
                        </div>
                      </Panel>
                      <Panel headerText="Storage" fixed>
                        <div>
                          {(s.status.storages?.length ?? 0) === 0 && <Text>-</Text>}
                          {s.status.storages?.map((st, idx) => (
                            <div key={`st-${idx}`} style={{ marginBottom: '0.5rem' }}>
                              <div>
                                <Text style={{ fontWeight: 600, color: 'var(--sapTextColor)', marginRight: '0.25rem' }}>
                                  {st.name ?? 'Storage'}
                                </Text>
                                {st.state ? <ObjectStatus state={statusToObjectState(st.state)}>{st.state}</ObjectStatus> : null}
                              </div>
                              {st.drives && st.drives.length > 0 && (
                                <div style={{ marginTop: '0.25rem' }}>
                                  <Text>
                                    Drives: {st.drives.map((d) => `${d.name ?? ''} ${d.model ?? ''} ${typeof d.capacity === 'number' ? formatByteSize(d.capacity) : (d.capacity ?? '')}`).join(', ')}
                                  </Text>
                                </div>
                              )}
                              {st.volumes && st.volumes.length > 0 && (
                                <div style={{ marginTop: '0.25rem' }}>
                                  <Text>
                                    Volumes: {st.volumes.map((v) => `${v.name ?? ''} ${v.raidType ?? ''} ${typeof v.capacity === 'number' ? formatByteSize(v.capacity) : (v.capacity ?? '')}`).join(', ')}
                                  </Text>
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      </Panel>
                    </div>
                  );
                })()}
              </Panel>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}


