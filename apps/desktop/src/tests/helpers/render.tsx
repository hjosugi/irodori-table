import { render, type RenderResult } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentType, ReactElement } from "react";

export type UserEvent = ReturnType<typeof userEvent.setup>;

export interface RenderUiResult extends RenderResult {
  user: UserEvent;
}

/**
 * Render a element and hand back a `user-event` session bound to it.
 *
 * Cleanup is global (src/tests/setup.ts), so tests never unmount by hand.
 */
export function renderUi(ui: ReactElement): RenderUiResult {
  const user = userEvent.setup();
  return { ...render(ui), user };
}

export interface RenderComponentResult<P> extends RenderUiResult {
  /** The props the component was actually rendered with, merged overrides
   *  included, so a test can assert on the spies it passed in. */
  props: P;
}

/**
 * Build a renderer for the shape nearly every component test here uses: a large
 * default prop object, a `Partial` override per test, and a render that returns
 * the props so assertions can reach the `vi.fn()` handlers.
 *
 * `makeDefaults` is a factory rather than an object on purpose: props normally
 * hold `vi.fn()` spies, and a shared object would carry call counts from one
 * test into the next.
 *
 * `NoInfer` keeps `P` pinned to the component's own props. Without it the
 * defaults object widens the type — `error: null` would narrow the parameter to
 * `null`, and overrides passing a real error would stop compiling.
 */
export function componentRenderer<P extends object>(
  Component: ComponentType<P>,
  makeDefaults: () => NoInfer<P>,
) {
  return (overrides: Partial<P> = {}): RenderComponentResult<P> => {
    const props = { ...makeDefaults(), ...overrides };
    const user = userEvent.setup();
    return { ...render(<Component {...props} />), props, user };
  };
}
