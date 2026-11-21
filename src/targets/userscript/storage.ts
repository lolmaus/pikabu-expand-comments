import type { StoragePort } from "../../core/settings.ts";

interface UserscriptStorage {
  getValue(key: string): Promise<unknown>;
  setValue(key: string, value: boolean): Promise<void>;
}

export function createUserscriptStorage(gm: UserscriptStorage): StoragePort {
  return {
    get: (key) => gm.getValue(key),
    set: (key, value) => gm.setValue(key, value),
  };
}
