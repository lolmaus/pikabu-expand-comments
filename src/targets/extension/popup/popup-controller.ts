import type { ExpansionSnapshot } from "../../../core/expansion-run.ts";
import { createSettings } from "../../../core/settings.ts";
import type { PostPageRuntimeState } from "../../shared/post-page-runtime.ts";
import {
  createPopupRequest,
  isContentStateResponse,
  isContentToPopupMessage,
} from "../protocol.ts";
import { createExtensionStorage } from "../storage.ts";
import type { RuntimeMessageListener, WebExtApi } from "../webext-api.ts";
import { createPopupTranslator, type PopupTranslator } from "./i18n.ts";

export interface PopupElements {
  version: HTMLElement;
  activeCard: HTMLElement;
  offsiteCard: HTMLElement;
  status: HTMLElement;
  counter: HTMLElement;
  actionButton: HTMLButtonElement;
  actionLabel: HTMLElement;
  stopSquare: HTMLElement;
  offsiteHint: HTMLElement;
  openPikabuLink: HTMLAnchorElement;
  autoExpandTitle: HTMLElement;
  autoExpandDesc: HTMLElement;
  autoExpandSwitch: HTMLInputElement;
}

export interface PopupController {
  ready: Promise<void>;
  dispose(): void;
}

function formatPopupStatus(snapshot: ExpansionSnapshot, translator: PopupTranslator): string {
  switch (snapshot.state) {
    case "idle":
      return translator.t("popupStatusIdle");
    case "running":
      return translator.t("popupStatusRunning");
    case "stopped":
      return translator.t("popupStatusStopped");
    case "error":
      return translator.t("popupStatusError");
    case "completed":
      if (snapshot.initiallyEmpty) return translator.t("popupStatusAlreadyExpanded");
      if (snapshot.skippedCount === 1) return translator.t("popupStatusSkippedOne");
      if (snapshot.skippedCount > 1) {
        const count = String(snapshot.skippedCount);
        if (translator.locale.toLowerCase().startsWith("ru")) {
          const category = new Intl.PluralRules("ru-RU").select(snapshot.skippedCount);
          if (category === "one") {
            const oneCount = translator.t("popupStatusSkippedOneCount", count);
            if (oneCount !== "popupStatusSkippedOneCount") return oneCount;
          }
          if (category === "few") {
            const few = translator.t("popupStatusSkippedFew", count);
            if (few !== "popupStatusSkippedFew") return few;
          }
        }
        return translator.t("popupStatusSkippedMany", count);
      }
      return translator.t("popupStatusCompletedAll");
  }
}

function formatPopupActionLabel(snapshot: ExpansionSnapshot, translator: PopupTranslator): string {
  switch (snapshot.state) {
    case "idle":
      return translator.t("popupExpandAll");
    case "running":
      return translator.t("popupStop");
    case "stopped":
      return translator.t("popupContinue");
    case "error":
      return translator.t("popupRetry");
    case "completed":
      return "";
  }
}

function formatPopupCounter(snapshot: ExpansionSnapshot, translator: PopupTranslator) {
  if (snapshot.totalCommentsCount === undefined) {
    const open = String(snapshot.loadedCommentsCount);
    return {
      text: open,
      ariaLabel: translator.t("popupCounterOpenOnlyAriaLabel", open),
    };
  }
  const open = String(snapshot.loadedCommentsCount);
  const total = String(Math.max(snapshot.totalCommentsCount, snapshot.loadedCommentsCount));
  return {
    text: `${open}\u00a0/\u00a0${total}`,
    ariaLabel: translator.t("popupCounterAriaLabel", [open, total]),
  };
}

export function mountExtensionPopup(
  elements: PopupElements,
  api: WebExtApi,
  doc: Document = document,
): PopupController {
  const translator = createPopupTranslator(api);
  const settings = createSettings(createExtensionStorage(api));
  const manifestVersion = api.runtime.getManifest().version;

  if (translator.locale) {
    doc.documentElement.lang = translator.locale.split("-")[0] || "en";
  }
  elements.version.textContent = `v${manifestVersion}`;
  elements.offsiteHint.textContent = translator.t("popupOffSiteHint");
  elements.openPikabuLink.textContent = `${translator.t("popupOpenPikabu")} ↗`;
  elements.autoExpandTitle.textContent = translator.t("popupAutoExpandTitle");
  elements.autoExpandDesc.textContent = translator.t("popupAutoExpandDesc");

  let activeTabId: number | undefined;
  let currentState: PostPageRuntimeState = { hasCommentView: false, snapshot: null };
  let disposed = false;
  let pendingSave: Promise<void> = Promise.resolve();

  function renderState(state: PostPageRuntimeState) {
    currentState = state;
    if (!state.hasCommentView || !state.snapshot) {
      elements.activeCard.hidden = true;
      elements.offsiteCard.hidden = false;
      return;
    }

    const { snapshot } = state;
    elements.activeCard.hidden = false;
    elements.offsiteCard.hidden = true;

    const status = formatPopupStatus(snapshot, translator);
    elements.status.textContent = status;
    elements.status.dataset["error"] = String(snapshot.state === "error");

    const counter = formatPopupCounter(snapshot, translator);
    elements.counter.textContent = counter.text;
    elements.counter.setAttribute("aria-label", counter.ariaLabel);
    elements.counter.title = counter.ariaLabel;

    const isCompleted = snapshot.state === "completed";
    const isRunning = snapshot.state === "running";
    elements.actionButton.hidden = isCompleted;
    elements.actionButton.dataset["running"] = String(isRunning);
    elements.stopSquare.hidden = !isRunning;
    elements.actionLabel.textContent = formatPopupActionLabel(snapshot, translator);
  }

  renderState(currentState);

  const onActionClick = () => {
    if (activeTabId === undefined || !currentState.snapshot || !api.tabs) return;
    const actionType = currentState.snapshot.state === "running" ? "stop" : "start";
    void api.tabs
      .sendMessage(activeTabId, createPopupRequest(actionType))
      .then((response) => {
        if (!disposed && isContentStateResponse(response)) {
          renderState(response.state);
        }
      })
      .catch(() => {
        if (!disposed) renderState({ hasCommentView: false, snapshot: null });
      });
  };
  elements.actionButton.addEventListener("click", onActionClick);

  elements.autoExpandSwitch.disabled = true;
  const onSwitchChange = () => {
    const enabled = elements.autoExpandSwitch.checked;
    pendingSave = pendingSave
      .then(() => settings.setAutoExpandOnVisit(enabled))
      .catch(() => {
        if (!disposed) {
          elements.autoExpandSwitch.checked = !enabled;
        }
      });
  };
  elements.autoExpandSwitch.addEventListener("change", onSwitchChange);

  const unsubscribeStorage = settings.subscribeAutoExpandOnVisit((enabled) => {
    if (!disposed) {
      elements.autoExpandSwitch.checked = enabled;
      elements.autoExpandSwitch.disabled = false;
    }
  });

  const onRuntimeMessage: RuntimeMessageListener = (message, sender) => {
    if (disposed || !isContentToPopupMessage(message)) return;
    if (
      activeTabId !== undefined &&
      sender.tab?.id !== undefined &&
      sender.tab.id !== activeTabId
    ) {
      return;
    }
    renderState(message.state);
  };
  api.runtime.onMessage.addListener(onRuntimeMessage);

  const loadStorage = settings
    .getAutoExpandOnVisit()
    .then((enabled) => {
      if (!disposed) {
        elements.autoExpandSwitch.checked = enabled;
        elements.autoExpandSwitch.disabled = false;
      }
    })
    .catch(() => {
      if (!disposed) {
        elements.autoExpandSwitch.checked = false;
        elements.autoExpandSwitch.disabled = false;
      }
    });

  const loadActiveTabState = (async () => {
    if (!api.tabs) {
      renderState({ hasCommentView: false, snapshot: null });
      return;
    }
    try {
      const tabs = await api.tabs.query({ active: true, currentWindow: true });
      const activeTab = tabs[0];
      if (!activeTab || activeTab.id === undefined) {
        renderState({ hasCommentView: false, snapshot: null });
        return;
      }
      activeTabId = activeTab.id;
      const response = await api.tabs.sendMessage(activeTabId, createPopupRequest("getState"));
      if (!disposed && isContentStateResponse(response)) {
        renderState(response.state);
      } else if (!disposed) {
        renderState({ hasCommentView: false, snapshot: null });
      }
    } catch {
      if (!disposed) {
        renderState({ hasCommentView: false, snapshot: null });
      }
    }
  })();

  return {
    ready: Promise.all([loadStorage, loadActiveTabState]).then(() => {}),
    dispose() {
      disposed = true;
      elements.actionButton.removeEventListener("click", onActionClick);
      elements.autoExpandSwitch.removeEventListener("change", onSwitchChange);
      unsubscribeStorage();
      api.runtime.onMessage.removeListener(onRuntimeMessage);
    },
  };
}
