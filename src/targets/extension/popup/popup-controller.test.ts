import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test, vi } from "vitest";
import type { PostPageRuntimeState } from "../../shared/post-page-runtime.ts";
import { createStateChangedMessage, createStateResponse } from "../protocol.ts";
import type {
  RuntimeMessageListener,
  StorageChangesMap,
  StorageOnChangedListener,
  WebExtApi,
} from "../webext-api.ts";
import { mountExtensionPopup, type PopupElements } from "./popup-controller.ts";

const popupHtml = readFileSync(
  resolve(process.cwd(), "src/targets/extension/popup/popup.html"),
  "utf8",
);

function buildPopupDom(): PopupElements {
  document.documentElement.innerHTML = popupHtml.replace(/^<!doctype html>/i, "");
  const get = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
  return {
    version: get("popup-version"),
    activeCard: get("active-card"),
    offsiteCard: get("offsite-card"),
    status: get("popup-status"),
    counter: get("popup-counter"),
    actionButton: get<HTMLButtonElement>("popup-action-btn"),
    actionLabel: get("popup-action-label"),
    stopSquare: get("popup-stop-square"),
    offsiteHint: get("popup-offsite-hint"),
    openPikabuLink: get<HTMLAnchorElement>("popup-open-pikabu"),
    autoExpandTitle: get("popup-auto-title"),
    autoExpandDesc: get("popup-auto-desc"),
    autoExpandSwitch: get<HTMLInputElement>("auto-expand-switch"),
  };
}

function createMockWebExtApi(options: {
  initialAutoExpand?: boolean;
  tabId?: number;
  sendMessageImpl: (tabId: number, message: unknown) => Promise<unknown>;
}) {
  const storageValues = new Map<string, unknown>();
  if (options.initialAutoExpand !== undefined) {
    storageValues.set("autoExpandOnVisit", options.initialAutoExpand);
  }
  const storageListeners = new Set<StorageOnChangedListener>();
  const runtimeListeners = new Set<RuntimeMessageListener>();
  const sendMessage = vi.fn(options.sendMessageImpl);

  const api: WebExtApi = {
    storage: {
      local: {
        async get(keys) {
          const list = Array.isArray(keys) ? keys : [keys];
          const out: Record<string, unknown> = {};
          for (const key of list) {
            if (storageValues.has(key)) out[key] = storageValues.get(key);
          }
          return out;
        },
        async set(items) {
          const changes: StorageChangesMap = {};
          for (const [key, value] of Object.entries(items)) {
            changes[key] = { oldValue: storageValues.get(key), newValue: value };
            storageValues.set(key, value);
          }
          for (const listener of storageListeners) listener(changes, "local");
        },
      },
      onChanged: {
        addListener: (listener) => storageListeners.add(listener),
        removeListener: (listener) => storageListeners.delete(listener),
      },
    },
    runtime: {
      onMessage: {
        addListener: (listener) => runtimeListeners.add(listener),
        removeListener: (listener) => runtimeListeners.delete(listener),
      },
      sendMessage: async () => undefined,
      getManifest: () => ({ version: "0.2.0" }),
    },
    tabs: {
      query: async () => (options.tabId === undefined ? [] : [{ id: options.tabId }]),
      sendMessage,
    },
    i18n: {
      getMessage: () => "",
      getUILanguage: () => "en-US",
    },
  };

  return {
    api,
    sendMessage,
    storageValues,
    emitExternalStorage(enabled: boolean) {
      const oldValue = storageValues.get("autoExpandOnVisit");
      storageValues.set("autoExpandOnVisit", enabled);
      for (const listener of storageListeners) {
        listener({ autoExpandOnVisit: { oldValue, newValue: enabled } }, "local");
      }
    },
    emitPush(state: PostPageRuntimeState, senderTabId = options.tabId) {
      for (const listener of runtimeListeners) {
        listener(
          createStateChangedMessage(state),
          senderTabId === undefined ? {} : { tab: { id: senderTabId } },
          () => {},
        );
      }
    },
  };
}

test("renders live Post Page state, sends start/stop, streams updates, and syncs Auto-Expand switch", async () => {
  const elements = buildPopupDom();
  const idleState: PostPageRuntimeState = {
    hasCommentView: true,
    snapshot: {
      state: "idle",
      loadedCommentsCount: 3,
      totalCommentsCount: 10,
      expandedStepsCount: 0,
      remainingLoadersCount: 2,
      skippedCount: 0,
      initiallyEmpty: false,
    },
  };
  const runningState: PostPageRuntimeState = {
    hasCommentView: true,
    snapshot: {
      ...idleState.snapshot!,
      state: "running",
      loadedCommentsCount: 5,
    },
  };
  const stoppedState: PostPageRuntimeState = {
    hasCommentView: true,
    snapshot: {
      ...runningState.snapshot!,
      state: "stopped",
      loadedCommentsCount: 6,
    },
  };

  const mock = createMockWebExtApi({
    initialAutoExpand: false,
    tabId: 42,
    sendMessageImpl: async (_tabId, message) => {
      const msg = message as { type: string };
      if (msg.type === "getState") return createStateResponse(idleState);
      if (msg.type === "start") return createStateResponse(runningState);
      if (msg.type === "stop") return createStateResponse(stoppedState);
      return undefined;
    },
  });

  const controller = mountExtensionPopup(elements, mock.api, document);
  await controller.ready;

  expect(elements.version.textContent).toBe("v0.2.0");
  expect(elements.activeCard.hidden).toBe(false);
  expect(elements.offsiteCard.hidden).toBe(true);
  expect(elements.counter.textContent).toBe("3\u00a0/\u00a010");
  expect(elements.actionLabel.textContent).toBe("Expand all comments");
  expect(elements.actionButton.dataset["running"]).toBe("false");
  expect(elements.autoExpandSwitch.checked).toBe(false);
  expect(elements.autoExpandSwitch.disabled).toBe(false);

  // Clicking Expand sends "start" and transitions CTA to Stop.
  elements.actionButton.click();
  await vi.waitFor(() => {
    expect(elements.actionLabel.textContent).toBe("Stop");
    expect(elements.actionButton.dataset["running"]).toBe("true");
    expect(elements.stopSquare.hidden).toBe(false);
    expect(elements.counter.textContent).toBe("5\u00a0/\u00a010");
  });

  // Live pushed update from another tab is ignored; active tab update renders.
  mock.emitPush(
    {
      hasCommentView: true,
      snapshot: { ...runningState.snapshot!, loadedCommentsCount: 99 },
    },
    999,
  );
  expect(elements.counter.textContent).toBe("5\u00a0/\u00a010");

  mock.emitPush({
    hasCommentView: true,
    snapshot: { ...runningState.snapshot!, loadedCommentsCount: 7 },
  });
  expect(elements.counter.textContent).toBe("7\u00a0/\u00a010");

  // Clicking Stop sends "stop" and transitions CTA to Continue.
  elements.actionButton.click();
  await vi.waitFor(() => {
    expect(elements.actionLabel.textContent).toBe("Continue");
    expect(elements.status.textContent).toBe("Expansion stopped.");
  });

  // Toggling Auto-Expand writes storage.local and external changes sync back into the switch.
  elements.autoExpandSwitch.checked = true;
  elements.autoExpandSwitch.dispatchEvent(new Event("change"));
  await vi.waitFor(() => {
    expect(mock.storageValues.get("autoExpandOnVisit")).toBe(true);
  });

  mock.emitExternalStorage(false);
  expect(elements.autoExpandSwitch.checked).toBe(false);

  controller.dispose();
});

test("falls back cleanly to the off-site card when active tab has no content script while keeping toggle working", async () => {
  const elements = buildPopupDom();
  const mock = createMockWebExtApi({
    initialAutoExpand: true,
    tabId: 7,
    sendMessageImpl: async () => {
      throw new Error("Could not establish connection. Receiving end does not exist.");
    },
  });

  const controller = mountExtensionPopup(elements, mock.api, document);
  await controller.ready;

  expect(elements.activeCard.hidden).toBe(true);
  expect(elements.offsiteCard.hidden).toBe(false);
  expect(elements.openPikabuLink.href).toBe("https://pikabu.ru/");
  expect(elements.openPikabuLink.rel).toBe("noopener noreferrer");
  expect(elements.autoExpandSwitch.checked).toBe(true);

  controller.dispose();
});

test("pluralizes Russian skipped branch counts accurately including 1, 2, 5, and 21", async () => {
  const ruCatalog = JSON.parse(
    readFileSync(resolve(process.cwd(), "src/targets/extension/_locales/ru/messages.json"), "utf8"),
  ) as Record<string, { message: string }>;

  const elements = buildPopupDom();
  const mock = createMockWebExtApi({
    initialAutoExpand: false,
    tabId: 12,
    sendMessageImpl: async () =>
      createStateResponse({
        hasCommentView: true,
        snapshot: {
          state: "completed",
          loadedCommentsCount: 20,
          totalCommentsCount: 41,
          expandedStepsCount: 10,
          remainingLoadersCount: 0,
          skippedCount: 1,
          initiallyEmpty: false,
        },
      }),
  });
  mock.api.i18n = {
    getUILanguage: () => "ru-RU",
    getMessage: (key, subs) => {
      const msg = ruCatalog[key]?.message ?? "";
      const first = Array.isArray(subs) ? (subs[0] ?? "") : (subs ?? "");
      return msg.replaceAll("$COUNT$", first);
    },
  };

  const controller = mountExtensionPopup(elements, mock.api, document);
  await controller.ready;
  expect(elements.status.textContent).toBe("Одну ветку не удалось раскрыть.");

  for (const [skippedCount, expected] of [
    [2, "Не удалось раскрыть 2 ветки."],
    [5, "Не удалось раскрыть 5 веток."],
    [21, "Не удалось раскрыть 21 ветку."],
  ] as const) {
    mock.emitPush({
      hasCommentView: true,
      snapshot: {
        state: "completed",
        loadedCommentsCount: 20,
        totalCommentsCount: 41,
        expandedStepsCount: 10,
        remainingLoadersCount: 0,
        skippedCount,
        initiallyEmpty: false,
      },
    });
    expect(elements.status.textContent).toBe(expected);
  }

  controller.dispose();
});
