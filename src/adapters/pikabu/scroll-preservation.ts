const overflowAnchor = "overflow-anchor";
const manualScrollPauseMs = 150;
const scrollKeys = new Set(["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " "]);

export function createScrollPreservation(
  document: Document,
  getContainer: () => HTMLElement | null,
  getTopInset: () => number = () => 0,
) {
  const page = document.defaultView!;
  let listening: AbortController | undefined;
  let previousStyle: { container: HTMLElement; value: string; priority: string } | undefined;
  let anchor: { element: Element; top: number } | undefined;
  let pinnedAnchor: { element: Element; top: number } | undefined;
  let pinnedResizeObserver: ResizeObserver | undefined;
  let resumeAt = 0;
  let scrollY = page.scrollY;

  function clearTargetLock() {
    pinnedAnchor = undefined;
    pinnedResizeObserver?.disconnect();
    pinnedResizeObserver = undefined;
  }

  function yieldToReader() {
    clearTargetLock();
    anchor = undefined;
    resumeAt = page.performance.now() + manualScrollPauseMs;
  }

  function trackScroll() {
    if (page.scrollY === scrollY) return;
    scrollY = page.scrollY;
    yieldToReader();
  }

  function onKeydown(event: KeyboardEvent) {
    if (!scrollKeys.has(event.key) || event.altKey || event.metaKey) return;
    const target = event.composedPath()[0];
    if (
      target instanceof Element &&
      target.closest("input, textarea, select, [contenteditable], [role='textbox']")
    )
      return;
    if (
      event.key === " " &&
      target instanceof Element &&
      target.closest("button, [role='button']")
    ) {
      return;
    }
    yieldToReader();
  }

  function syncContainer(container: HTMLElement | null) {
    if (previousStyle?.container === container) return;
    if (previousStyle) {
      const { container, value, priority } = previousStyle;
      container.style.setProperty(overflowAnchor, value, priority);
      previousStyle = undefined;
    }
    if (container) {
      previousStyle = {
        container,
        value: container.style.getPropertyValue(overflowAnchor),
        priority: container.style.getPropertyPriority(overflowAnchor),
      };
      container.style.setProperty(overflowAnchor, "none", "important");
    }
  }

  function compensate() {
    if (!listening) return;
    trackScroll();
    const target = pinnedAnchor ?? anchor;
    if (!target || !target.element.isConnected || target.element.getClientRects().length === 0) {
      return;
    }
    const offset = target.element.getBoundingClientRect().top - target.top;
    if (Math.abs(offset) >= 1) {
      page.scrollBy({ top: offset, behavior: "instant" });
      // Scroll events also fire for our own instant compensation.
      scrollY = page.scrollY;
    }
  }

  return {
    yieldToReader,
    clearTargetLock,
    lockTarget(element: Element) {
      clearTargetLock();
      if (!element.isConnected) return;
      pinnedAnchor = { element, top: element.getBoundingClientRect().top };
      anchor = pinnedAnchor;
      scrollY = page.scrollY;
      if (typeof page.ResizeObserver === "function") {
        const observed = element.parentElement ?? getContainer();
        if (observed) {
          pinnedResizeObserver = new page.ResizeObserver(() => {
            if (pinnedAnchor) compensate();
          });
          pinnedResizeObserver.observe(observed);
        }
      }
    },
    compensatePinned() {
      if (pinnedAnchor) compensate();
    },
    setRunning(running: boolean) {
      if (running) {
        if (!listening) {
          listening = new AbortController();
          scrollY = page.scrollY;
          const options = { capture: true, passive: true, signal: listening.signal };
          page.addEventListener("wheel", yieldToReader, options);
          page.addEventListener("touchstart", yieldToReader, options);
          page.addEventListener("keydown", onKeydown, options);
          page.addEventListener("scroll", trackScroll, { signal: listening.signal });
        }
        if (pinnedAnchor) anchor = pinnedAnchor;
        syncContainer(getContainer());
      } else {
        clearTargetLock();
        if (listening) {
          listening.abort();
          listening = undefined;
          syncContainer(null);
          anchor = undefined;
          resumeAt = 0;
        }
      }
    },

    capture() {
      if (!listening) {
        anchor = undefined;
        return;
      }
      trackScroll();
      if (pinnedAnchor) {
        anchor = pinnedAnchor;
        return;
      }
      anchor = undefined;
      if (page.performance.now() < resumeAt) return;
      const container = getContainer();
      if (!container) return;

      const topInset = Math.max(0, getTopInset());
      const bounds = container.getBoundingClientRect();
      const left = Math.max(0, bounds.left);
      const right = Math.min(page.innerWidth, bounds.right);
      if (right <= left || bounds.bottom <= topInset || bounds.top >= page.innerHeight) return;

      // Prefer the visible content at the top reading edge (below any sticky mobile header).
      const probeY = Math.min(page.innerHeight - 1, topInset + (topInset > 0 ? 4 : 0));
      const hit =
        typeof document.elementsFromPoint === "function"
          ? document
              .elementsFromPoint((left + right) / 2, probeY)
              .find((element) => container.contains(element) && element.closest(".comment"))
          : undefined;
      // The top reading edge can fall in a gap between comments.
      const comments = hit ? [] : Array.from(container.querySelectorAll(".comment"));
      const element =
        hit ??
        comments.find((comment) => {
          const { top, bottom } = comment.getBoundingClientRect();
          return bottom > top && top >= topInset && top < page.innerHeight;
        }) ??
        comments.find((comment) => {
          const { top, bottom } = comment.getBoundingClientRect();
          return bottom > top && bottom > topInset && top < page.innerHeight;
        });
      if (element) anchor = { element, top: element.getBoundingClientRect().top };
    },

    compensate,
  };
}
