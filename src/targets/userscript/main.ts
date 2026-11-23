import { bootPostPage, watchPostPage } from "../shared/post-page-runtime.ts";
import { createUserscriptStorage } from "./storage.ts";

declare const GM: Parameters<typeof createUserscriptStorage>[0];

// Userscript managers can wrap the global window independently of window.top.
bootPostPage(document.defaultView, (pageWindow) => {
  watchPostPage(pageWindow, {
    storage: createUserscriptStorage({
      getValue: (key) => GM.getValue(key),
      setValue: (key, value) => GM.setValue(key, value),
    }),
  });
});
