interface LuigiMockContext {
  token: string | null;
  namespace: string;
  accountId: string;
  userInfo: { id: string };
  portalContext: {
    crdGatewayApiUrl: string;
    namespace: string;
  } & Record<string, unknown>;
  [key: string]: unknown;
}

interface LuigiMockEvent {
  context: LuigiMockContext;
  __source: 'mock';
}

type InitListener = (context: LuigiMockContext) => void;
type UpdateListener = (context: LuigiMockContext) => void;

const buildDefaultContext = (): LuigiMockContext => {
  const env = (import.meta as any).env ?? {};
  const gqlUrl = env?.VITE_LUIGI_MOCK_GRAPHQL_URL || env?.VITE_GRAPHQL_URL || '/root/graphql';
  const token = env?.VITE_LUIGI_MOCK_TOKEN ?? env?.VITE_GRAPHQL_TOKEN ?? null;
  const namespace = env?.VITE_LUIGI_MOCK_NAMESPACE || 'default';
  const userId = env?.VITE_LUIGI_MOCK_USER_ID || 'demo-user';
  const accountId = env?.VITE_LUIGI_MOCK_ACCOUNT_ID || userId;

  return {
    token,
    namespace,
    accountId,
    userInfo: { id: userId },
    portalContext: {
      crdGatewayApiUrl: gqlUrl,
      namespace
    }
  };
};

export const ensureLuigiMock = (): void => {
  if (typeof window === 'undefined') return;
  const env = (import.meta as any).env ?? {};
  const shouldMock = Boolean(env?.DEV) || env?.VITE_ENABLE_LUIGI_MOCK === 'true';
  const globalAny = window as any;

  if (!shouldMock || globalAny.LuigiClient) {
    return;
  }

  let context: LuigiMockContext = {
    ...buildDefaultContext(),
    ...(globalAny.__PM_LUIGI_MOCK_CONTEXT__ ?? {})
  };

  const initListeners = new Map<string, InitListener>();
  const updateListeners = new Map<string, UpdateListener>();
  let counter = 0;

  const getEvent = (): LuigiMockEvent => ({ context, __source: 'mock' });

  const notifyUpdates = () => {
    const payload = context;
    updateListeners.forEach((listener) => {
      try {
        listener(payload);
      } catch (error) {
        console.warn('[LuigiMock] context listener threw', error);
      }
    });
  };

  const client = {
    __isMock: true,
    addInitListener(cb: InitListener): string {
      const id = `mock-init-${++counter}`;
      initListeners.set(id, cb);
      Promise.resolve().then(() => {
        try {
          cb(context);
        } catch (error) {
          console.warn('[LuigiMock] init listener threw', error);
        }
      });
      return id;
    },
    removeInitListener(id: string) {
      initListeners.delete(id);
    },
    addContextUpdateListener(cb: UpdateListener): string {
      const id = `mock-update-${++counter}`;
      updateListeners.set(id, cb);
      return id;
    },
    removeContextUpdateListener(id: string) {
      updateListeners.delete(id);
    },
    getEventData(): LuigiMockEvent {
      return getEvent();
    },
    __updateContext(partial: Partial<LuigiMockContext>) {
      context = {
        ...context,
        ...partial,
        portalContext: {
          ...context.portalContext,
          ...(partial.portalContext ?? {})
        }
      };
      notifyUpdates();
    }
  };

  globalAny.__PM_LUIGI_MOCK_CONTEXT__ = context;
  globalAny.__PM_LUIGI_MOCK__ = true;
  globalAny.LuigiClient = client;

  console.info('[LuigiMock] Injected mock Luigi client');
};

