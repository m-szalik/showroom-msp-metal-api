declare module '@luigi-project/client' {
  type ListenerId = string;

  interface LuigiClientLike {
    __isMock?: boolean;
    addInitListener(callback: (context: any) => ListenerId | void): ListenerId;
    removeInitListener(id: ListenerId): void;
    addContextUpdateListener(callback: (context: any) => ListenerId | void): ListenerId;
    removeContextUpdateListener(id: ListenerId): void;
    getEventData(): any;
    [key: string]: unknown;
  }

  const LuigiClient: LuigiClientLike;
  export default LuigiClient;
}

