export interface StoragePort {
  get(key: string): Promise<unknown>;
  set(key: string, value: boolean): Promise<void>;
}

const autoExpandOnVisitKey = "autoExpandOnVisit";

export function createSettings(storage: StoragePort) {
  return {
    async getAutoExpandOnVisit() {
      return (await storage.get(autoExpandOnVisitKey)) === true;
    },
    setAutoExpandOnVisit(enabled: boolean) {
      return storage.set(autoExpandOnVisitKey, enabled);
    },
  };
}
