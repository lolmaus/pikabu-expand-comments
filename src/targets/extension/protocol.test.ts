import { expect, test } from "vitest";
import {
  createPopupRequest,
  createStateChangedMessage,
  createStateResponse,
  isContentStateResponse,
  isContentToPopupMessage,
  isPopupToContentMessage,
} from "./protocol.ts";

test("constructs and validates popup <-> content script protocol messages", () => {
  const getState = createPopupRequest("getState");
  const start = createPopupRequest("start");
  const stop = createPopupRequest("stop");

  expect(isPopupToContentMessage(getState)).toBe(true);
  expect(isPopupToContentMessage(start)).toBe(true);
  expect(isPopupToContentMessage(stop)).toBe(true);
  expect(isPopupToContentMessage({ scope: "other", type: "start" })).toBe(false);
  expect(isPopupToContentMessage({ scope: "pikabu-expand-comments", type: "unknown" })).toBe(false);
  expect(isPopupToContentMessage(null)).toBe(false);

  const state = {
    hasCommentView: true,
    snapshot: {
      state: "idle" as const,
      loadedCommentsCount: 3,
      totalCommentsCount: 10,
      expandedStepsCount: 0,
      remainingLoadersCount: 2,
      skippedCount: 0,
      initiallyEmpty: false,
    },
  };

  const response = createStateResponse(state);
  expect(isContentStateResponse(response)).toBe(true);
  expect(isContentStateResponse({ scope: "pikabu-expand-comments", state: {} })).toBe(false);

  const pushed = createStateChangedMessage(state);
  expect(isContentToPopupMessage(pushed)).toBe(true);
  expect(isContentToPopupMessage(response)).toBe(false);
});
