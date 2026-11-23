import type { StoragePort } from "../../core/settings.ts";
import type { StorageChangesMap, WebExtApi } from "./webext-api.ts";

export function createExtensionStorage(api: Pick<WebExtApi, "storage">): StoragePort {
  return {
    async get(key: string) {
      const result = await api.storage.local.get(key);
      return result[key];
    },
    async set(key: string, value: boolean) {
      await api.storage.local.set({ [key]: value });
    },
    subscribe(key: string, onChange: (value: unknown) => void) {
      const listener = (changes: StorageChangesMap, areaName: string) => {
        if (areaName !== "local") return;
        const change = changes[key];
        if (!change) return;
        // Guard against Firefox Bugzilla 1833153 where storage.onChanged can include unchanged keys.
        if (Object.is(change.newValue, change.oldValue)) return;
        onChange(change.newValue);
      };
      api.storage.onChanged.addListener(listener);
      return () => {
        api.storage.onChanged.removeListener(listener);
      };
    },
  };
}
