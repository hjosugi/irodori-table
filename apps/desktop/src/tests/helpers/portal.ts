import { expect } from "vitest";

export interface FloatingSize {
  /** Widest the popover is allowed to be, in CSS pixels. */
  width: number;
  /** Tallest the popover is allowed to be, in CSS pixels. */
  height: number;
}

export interface PortaledPopoverExpectation extends FloatingSize {
  /**
   * Selector for the ancestor whose `overflow`/`transform` would clip or
   * mis-place the popover if it were rendered in place instead of portaled.
   */
  clippedBy: string;
}

/**
 * Assert a popover escaped its clipping ancestor and is pinned inside the
 * viewport.
 *
 * What this can prove under jsdom:
 *  - the element is in the document and not `display:none`/`visibility:hidden`;
 *  - it is a child of <body>, i.e. it really went through `createPortal` and is
 *    no longer inside the subtree named by `clippedBy`;
 *  - it is `position: fixed`, so a scrolled or transformed ancestor cannot drag
 *    it off-screen;
 *  - the coordinates it declares keep a box of `width`x`height` on screen.
 *
 * What it cannot prove: that the element is *painted*. jsdom applies no
 * stylesheet and lays nothing out, so `getBoundingClientRect()` is all zeros
 * and a real `overflow: hidden` clip is invisible to it. The portal-ancestry
 * check below is the stand-in: the popover must not live inside the container
 * that does the clipping. Genuine geometry belongs in the browser suite.
 */
export function expectPortaledIntoViewport(
  element: HTMLElement,
  { clippedBy, width, height }: PortaledPopoverExpectation,
) {
  expect(element).toBeVisible();

  expect(
    element.closest(clippedBy),
    `popover is still inside ${clippedBy}; it must be portaled out of it`,
  ).toBeNull();
  expect(element.parentElement, "popover should be portaled to <body>").toBe(
    document.body,
  );

  expect(
    element.style.position,
    "popover must be position:fixed so scrolled/transformed ancestors cannot move it",
  ).toBe("fixed");

  const left = Number.parseFloat(element.style.left);
  const top = Number.parseFloat(element.style.top);
  expect(Number.isFinite(left), "popover has no numeric left").toBe(true);
  expect(Number.isFinite(top), "popover has no numeric top").toBe(true);

  expect(left, "popover starts left of the viewport").toBeGreaterThanOrEqual(0);
  expect(top, "popover starts above the viewport").toBeGreaterThanOrEqual(0);
  expect(
    left + width,
    "popover overflows the right edge of the viewport",
  ).toBeLessThanOrEqual(window.innerWidth);
  expect(
    top + height,
    "popover overflows the bottom edge of the viewport",
  ).toBeLessThanOrEqual(window.innerHeight);
}
