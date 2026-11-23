export interface StorageChange {
  oldValue?: unknown;
  newValue?: unknown;
}

export type StorageChangesMap = Record<string, StorageChange>;
export type StorageOnChangedListener = (changes: StorageChangesMap, areaName: string) => void;

export interface WebExtTab {
  id?: number;
  url?: string;
}

export interface WebExtMessageSender {
  tab?: WebExtTab;
}

export type RuntimeMessageListener = (
  message: unknown,
  sender: WebExtMessageSender,
  sendResponse: (response?: unknown) => void,
) => boolean | Promise<unknown> | void;

export interface WebExtApi {
  storage: {
    local: {
      get(keys: string | string[]): Promise<Record<string, unknown>>;
      set(items: Record<string, unknown>): Promise<void>;
    };
    onChanged: {
      addListener(listener: StorageOnChangedListener): void;
      removeListener(listener: StorageOnChangedListener): void;
    };
  };
  runtime: {
    onMessage: {
      addListener(listener: RuntimeMessageListener): void;
      removeListener(listener: RuntimeMessageListener): void;
    };
    sendMessage(message: unknown): Promise<unknown>;
    getManifest(): { version: string; name?: string };
  };
  tabs?: {
    query(queryInfo: { active?: boolean; currentWindow?: boolean }): Promise<WebExtTab[]>;
    sendMessage(tabId: number, message: unknown): Promise<unknown>;
  };
  i18n?: {
    getMessage(messageName: string, substitutions?: string | string[]): string;
    getUILanguage?(): string;
  };
}

interface ExtensionGlobalThis {
  browser?: WebExtApi;
  chrome?: WebExtApi;
}

export function getWebExtApi(scope: unknown = globalThis): WebExtApi | undefined {
  const extGlobal = scope as ExtensionGlobalThis | undefined;
  return extGlobal?.browser ?? extGlobal?.chrome;
}
