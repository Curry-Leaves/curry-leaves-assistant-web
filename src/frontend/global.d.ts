/// <reference types="vite/client" />
export {};

declare global {
  interface Window {
    curryLeaves?: {
      getBackendUrl(): Promise<string | null>;
      getAppVersion(): Promise<string>;
      onBackendReady(cb: (url: string) => void): void;
      onBackendError(cb: (msg: string) => void): void;
      onToggleRecording(cb: () => void): void;
      notify(title: string, body?: string, tag?: string): Promise<void>;
      /** Optional: older desktop builds' preload lacks this — feature-detect before use. */
      onNotifyClick?(cb: (tag: string | null) => void): void;
    };
  }
}
