export interface ObjectReference {
  name: string;
  namespace?: string;
}

export interface ServerSpec {
  uuid: string; // required per CRD
  systemUUID?: string;
  power?: string; // desired power
  indicatorLED?: string; // desired indicator state
  serverClaimRef?: ObjectReference | null;
}

export interface ServerStatus {
  manufacturer?: string;
  model?: string;
  powerState?: string; // current power
  indicatorLED?: string; // current indicator
  state?: string;
  biosVersion?: string;
  serialNumber?: string;
  sku?: string;
  totalSystemMemory?: number | string;

  processors?: Array<{
    id: string;
    manufacturer?: string;
    model?: string;
    architecture?: string;
    instructionSet?: string;
    maxSpeedMHz?: number;
    totalCores?: number;
    totalThreads?: number;
    type?: string;
  }>;

  networkInterfaces?: Array<{
    name: string;
    macAddress: string;
    ip: string;
  }>;

  storages?: Array<{
    name?: string;
    state?: string;
    drives?: Array<{
      name?: string;
      capacity?: number | string;
      mediaType?: string;
      model?: string;
      type?: string;
      vendor?: string;
      state?: string;
    }>;
    volumes?: Array<{
      name?: string;
      capacity?: number | string;
      raidType?: string;
      state?: string;
      volumeUsage?: string;
    }>;
  }>;
}

export interface Server {
  apiVersion?: string;
  kind?: string;
  metadata: { name: string; annotations?: Record<string, string> };
  spec: ServerSpec;
  status: ServerStatus;
  claimedBy?: string;
}

export interface ServerClaimSpec {
  image: string; // required
  power: string; // required
  serverRef?: ObjectReference; // immutable once set
  ignitionSecretRef?: ObjectReference;
}

export interface ServerClaimStatus {
  phase?: string;
}

export interface ServerClaim {
  apiVersion?: string;
  kind?: string;
  metadata: { name: string; namespace?: string; annotations?: Record<string, string> };
  spec: ServerClaimSpec;
  status?: ServerClaimStatus;
  owner?: string;
}


