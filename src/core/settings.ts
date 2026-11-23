export interface StoragePort {
  get(key: string): Promise<unknown>;
  set(key: string, value: boolean): Promise<void>;
  subscribe?(key: string, onChange: (value: unknown) => void): () => void;
}

export const autoExpandOnVisitKey = "autoExpandOnVisit";

export function createSettings(storage: StoragePort) {
  return {
    async getAutoExpandOnVisit() {
      return (await storage.get(autoExpandOnVisitKey)) === true;
    },
    setAutoExpandOnVisit(enabled: boolean) {
      return storage.set(autoExpandOnVisitKey, enabled);
    },
    subscribeAutoExpandOnVisit(onChange: (enabled: boolean) => void) {
      if (!storage.subscribe) return () => {};
      return storage.subscribe(autoExpandOnVisitKey, (value) => {
        onChange(value === true);
      });
    },
  };
}
