import type { PostPageRuntimeState } from "../shared/post-page-runtime.ts";

export type PopupToContentMessage =
  | { readonly scope: "pikabu-expand-comments"; readonly type: "getState" }
  | { readonly scope: "pikabu-expand-comments"; readonly type: "start" }
  | { readonly scope: "pikabu-expand-comments"; readonly type: "stop" };

export interface ContentStateResponse {
  readonly scope: "pikabu-expand-comments";
  readonly state: PostPageRuntimeState;
}

export interface ContentToPopupMessage {
  readonly scope: "pikabu-expand-comments";
  readonly type: "stateChanged";
  readonly state: PostPageRuntimeState;
}

export const MESSAGE_SCOPE = "pikabu-expand-comments" as const;

export function createPopupRequest(type: PopupToContentMessage["type"]): PopupToContentMessage {
  return { scope: MESSAGE_SCOPE, type };
}

export function createStateResponse(state: PostPageRuntimeState): ContentStateResponse {
  return { scope: MESSAGE_SCOPE, state };
}

export function createStateChangedMessage(state: PostPageRuntimeState): ContentToPopupMessage {
  return { scope: MESSAGE_SCOPE, type: "stateChanged", state };
}

export function isPopupToContentMessage(value: unknown): value is PopupToContentMessage {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return (
    candidate["scope"] === MESSAGE_SCOPE &&
    (candidate["type"] === "getState" ||
      candidate["type"] === "start" ||
      candidate["type"] === "stop")
  );
}

export function isContentStateResponse(value: unknown): value is ContentStateResponse {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  const state = candidate["state"] as Record<string, unknown> | undefined;
  return (
    candidate["scope"] === MESSAGE_SCOPE &&
    Boolean(state && typeof state === "object" && typeof state["hasCommentView"] === "boolean")
  );
}

export function isContentToPopupMessage(value: unknown): value is ContentToPopupMessage {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return (
    candidate["scope"] === MESSAGE_SCOPE &&
    candidate["type"] === "stateChanged" &&
    isContentStateResponse({ scope: MESSAGE_SCOPE, state: candidate["state"] })
  );
}
