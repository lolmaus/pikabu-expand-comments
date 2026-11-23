import {
  bootPostPage,
  watchPostPage,
  type PostPageController,
} from "../shared/post-page-runtime.ts";
import {
  createStateChangedMessage,
  createStateResponse,
  isPopupToContentMessage,
} from "./protocol.ts";
import { createExtensionStorage } from "./storage.ts";
import { getWebExtApi, type RuntimeMessageListener, type WebExtApi } from "./webext-api.ts";

export function attachExtensionContentScript(page: Window, api: WebExtApi): () => void {
  const controller: PostPageController = watchPostPage(page, {
    storage: createExtensionStorage(api),
    onSnapshot(state) {
      // Push live updates when the popup is open; ignore rejection when no popup is listening.
      void Promise.resolve(api.runtime.sendMessage(createStateChangedMessage(state))).catch(
        () => {},
      );
    },
  });

  const handleMessage: RuntimeMessageListener = (message, _sender, sendResponse) => {
    if (!isPopupToContentMessage(message)) return;
    if (message.type === "start") {
      controller.start();
    } else if (message.type === "stop") {
      controller.stop();
    }
    sendResponse(createStateResponse(controller.getState()));
  };

  api.runtime.onMessage.addListener(handleMessage);
  return () => {
    api.runtime.onMessage.removeListener(handleMessage);
    controller.dispose();
  };
}

const api = getWebExtApi();
if (api) {
  bootPostPage(document.defaultView, (pageWindow) => {
    attachExtensionContentScript(pageWindow, api);
  });
}
