import type { PostPageAdapter } from "../../core/expansion-run.ts";
import { measureStickyTopInset, type CommentTabKind } from "./comment-view.ts";
import { createScrollPreservation } from "./scroll-preservation.ts";

const replyBranch = ".comment-toggle-children";
const collapseClass = "comment-toggle-children_collapse";
const collapsedReplyBranch = `${replyBranch}.${collapseClass}`;
const collapseControl = ".comment__collapsing-area, .comment__close-branch";
const commentBatch = ".comment__more";
const placeholder =
  ".comment_loading-hidden, .comment_placeholder, .comment:has(> .comment__placeholder)";
const hidden = `[hidden], ${placeholder}`;
const hydrationTimeoutMs = 15_000;

function parseCommentCount(value: string | null | undefined) {
  const normalized = value?.replace(/\s+/g, "").trim();
  if (!normalized || !/^\d+$/.test(normalized)) return undefined;
  return Number.parseInt(normalized, 10);
}

function readTotalCommentsCount(document: Document, tabKind: CommentTabKind) {
  if (tabKind === "author") return undefined;
  const fromStory = parseCommentCount(
    document.querySelector("article.story")?.getAttribute("data-comments"),
  );
  if (fromStory !== undefined) return fromStory;
  return parseCommentCount(document.querySelector(".story__comments-link-count")?.textContent);
}

export function createPostPageAdapter(
  initialContainer: HTMLElement,
  tabKind: CommentTabKind = "all",
): PostPageAdapter<HTMLElement> & {
  setRunning(running: boolean): void;
  yieldScrollPreservation(): void;
  lockScrollTarget(element: Element): void;
  clearScrollTargetLock(): void;
} {
  // Pikabu can replace the comment list while keeping the surrounding view,
  // and renders multiple containers inside `.story-comments__author`.
  const view =
    initialContainer.closest(".story-comments__all, .story-comments__author") ??
    initialContainer.parentElement ??
    initialContainer;
  const replyIdentities = new Map<string, object>();

  function currentContainers() {
    if (view === initialContainer) return [initialContainer];
    return Array.from(view.querySelectorAll<HTMLElement>(".comments__container"));
  }

  function currentContainer() {
    return currentContainers()[0] ?? null;
  }

  function containsInActiveContainers(node: Node) {
    return currentContainers().some((container) => container.contains(node));
  }

  const ownerDocument = initialContainer.ownerDocument;
  const scroll = createScrollPreservation(ownerDocument, currentContainer, () =>
    ownerDocument.defaultView ? measureStickyTopInset(ownerDocument, ownerDocument.defaultView) : 0,
  );

  function visibleElements(selector: string) {
    return currentContainers().flatMap((container) =>
      Array.from(container.querySelectorAll<HTMLElement>(selector)).filter(
        (element) => !element.closest(hidden),
      ),
    );
  }

  function isHydrating() {
    const containers = currentContainers();
    if (containers.length === 0) return true;
    return containers.some((container) =>
      Array.from(container.querySelectorAll(placeholder)).some(
        (element) => !element.closest("[hidden]"),
      ),
    );
  }

  function observeChanges(onChange: () => void) {
    const observer = new MutationObserver((records) => {
      if (
        records.every(
          (record) =>
            record.target instanceof Element &&
            record.target.hasAttribute("data-pikabu-expand-comments"),
        )
      ) {
        return;
      }
      scroll.compensatePinned();
      onChange();
    });
    observer.observe(view, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["class", "hidden", "disabled"],
    });
    return () => observer.disconnect();
  }

  function observeManualCollapses(onCollapse: (loader: HTMLElement) => void) {
    function onClick(event: Event) {
      // Capture the expanded state before Pikabu's click handler changes it.
      if (!(event.target instanceof Element)) return;
      const close = event.target.closest(collapseControl);
      const loader =
        event.target.closest(replyBranch) ?? close?.parentElement?.previousElementSibling;
      if (
        loader instanceof HTMLElement &&
        loader.matches(replyBranch) &&
        !loader.classList.contains(collapseClass) &&
        containsInActiveContainers(loader)
      ) {
        onCollapse(loader);
      }
    }
    view.addEventListener("click", onClick, true);
    return () => view.removeEventListener("click", onClick, true);
  }

  function observeUntil(settled: () => boolean, signal?: AbortSignal, click?: () => void) {
    signal?.throwIfAborted();
    return new Promise<boolean>((resolve, reject) => {
      const disconnect = observeChanges(check);
      const timeout = setTimeout(() => finish(false), hydrationTimeoutMs);

      function cleanup() {
        disconnect();
        clearTimeout(timeout);
        signal?.removeEventListener("abort", abort);
      }

      function finish(didSettle: boolean) {
        cleanup();
        resolve(didSettle);
      }

      function abort() {
        cleanup();
        reject(signal?.reason);
      }

      function check() {
        if (click) scroll.compensate();
        if (settled()) finish(true);
      }

      signal?.addEventListener("abort", abort, { once: true });
      click?.();
      if (signal?.aborted) return;
      check();
    });
  }

  async function expandReplyBranch(loader: HTMLElement, signal?: AbortSignal) {
    const observedPlaceholders = new Set<Element>();
    function replyContainer() {
      const children = loader.nextElementSibling;
      return children?.matches(".comment__children") ? children : undefined;
    }
    function hasHydratedReplies() {
      return Boolean(replyContainer()?.querySelector(`.comment:not(${placeholder})`));
    }
    let opened = false;
    let withdrawn = false;
    let readerClosedBranch = false;
    const stopObservingCollapses = observeManualCollapses((closedLoader) => {
      if (closedLoader === loader || closedLoader.nextElementSibling?.contains(loader)) {
        readerClosedBranch = true;
      }
    });

    const settled = await observeUntil(
      () => {
        const collapsed = loader.classList.contains(collapseClass);
        // Collapsing a branch can hide or remove a loading descendant.
        withdrawn =
          !containsInActiveContainers(loader) ||
          loader.parentElement?.closest("[hidden]") != null ||
          (readerClosedBranch && collapsed);
        opened ||= !collapsed;
        if (!withdrawn) {
          replyContainer()
            ?.querySelectorAll(placeholder)
            .forEach((comment) => {
              if (!comment.closest("[hidden]")) observedPlaceholders.add(comment);
            });
        }
        if (isHydrating()) return false;
        if (!withdrawn) return !collapsed && hasHydratedReplies();
        // Let any observed in-flight replies finish even if a reader hides them.
        return !Array.from(observedPlaceholders).some(
          (comment) => containsInActiveContainers(comment) && comment.matches(placeholder),
        );
      },
      signal,
      () => loader.click(),
    ).finally(stopObservingCollapses);

    if (withdrawn && !isHydrating()) return "withdrawn";
    if (settled) return "expanded";
    if (!loader.classList.contains(collapseClass) && !isHydrating() && !hasHydratedReplies()) {
      return "skipped";
    }
    return {
      timeout: new Error("Pikabu Reply Branch hydration timed out.", {
        cause: {
          commentId: loader.closest(".comment")?.getAttribute("data-id"),
          opened,
          withdrawn,
          collapsed: loader.matches(collapsedReplyBranch),
          connected: loader.isConnected,
          hasReplyContainer: Boolean(replyContainer()),
          hasHydratedReplies: hasHydratedReplies(),
          isHydrating: isHydrating(),
        },
      }),
    };
  }

  async function expandCommentBatch(loader: HTMLElement, signal?: AbortSignal) {
    // A batch can reveal replies below the existing root and reuse the same button.
    const remainingBatchLabel = () => loader.querySelector(".comments__more-count")?.textContent;
    const previousBatchLabel = remainingBatchLabel();
    const previousCount = Number.parseInt(previousBatchLabel ?? "", 10);
    const previousComments = new Set(visibleElements(".comment"));
    const settled = await observeUntil(
      () =>
        !isHydrating() &&
        (!containsInActiveContainers(loader) ||
          Number.parseInt(remainingBatchLabel() ?? "", 10) < previousCount ||
          visibleElements(".comment").some((comment) => !previousComments.has(comment))),
      signal,
      () => loader.click(),
    );
    if (!settled) {
      return {
        timeout: new Error("Pikabu Comment Batch hydration timed out.", {
          cause: {
            connected: loader.isConnected,
            visibleCommentsBefore: previousComments.size,
            visibleCommentsAfter: visibleElements(".comment").length,
            previousBatchCount: previousBatchLabel,
            remainingBatchCount: remainingBatchLabel(),
            isHydrating: isHydrating(),
          },
        }),
      };
    }
    return loader.isConnected ? "next-batch" : "expanded";
  }

  return {
    setRunning: scroll.setRunning,
    yieldScrollPreservation: scroll.yieldToReader,
    lockScrollTarget: scroll.lockTarget,
    clearScrollTargetLock: scroll.clearTargetLock,
    observeChanges,
    observeManualCollapses,

    identify(loader) {
      if (!loader.matches(replyBranch)) return loader;
      const comment = loader.closest(".comment");
      const id = comment?.getAttribute("data-id") || comment?.id;
      if (!id) return loader;

      // A re-render can replace the toggle for the same comment.
      const existing = replyIdentities.get(id);
      if (existing) return existing;
      const identity = {};
      replyIdentities.set(id, identity);
      return identity;
    },

    read() {
      const totalCommentsCount = readTotalCommentsCount(initialContainer.ownerDocument, tabKind);
      return {
        loadedCommentsCount: visibleElements(".comment").length,
        ...(totalCommentsCount === undefined ? {} : { totalCommentsCount }),
        loaders: [
          ...visibleElements(collapsedReplyBranch),
          ...visibleElements(commentBatch),
        ].filter((element) => !element.matches(":disabled")),
        isHydrating: isHydrating(),
      };
    },

    async waitForHydration(signal) {
      if (isHydrating() && !(await observeUntil(() => !isHydrating(), signal))) {
        throw new Error("Pikabu comment hydration timed out.");
      }
    },

    expand(loader, signal) {
      signal?.throwIfAborted();
      scroll.capture();
      return loader.matches(collapsedReplyBranch)
        ? expandReplyBranch(loader, signal)
        : expandCommentBatch(loader, signal);
    },
  };
}
