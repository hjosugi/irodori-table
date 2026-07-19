import { describe, expect, it } from "vitest";
import { uiZoomStyleVariables } from "@/app/app-workbench-utils";

// The UI reads as one scale only while every font-size goes through a token.
// Before this, 182 declarations hardcoded a px size and the app rendered at 9,
// 10, 10.5, 11, 11.5, 12, 12.5, 13, 14, 15, 16, 18 and 20px at once, none of
// them anchored to the menu bar the rest of the UI is read against.
//
// These inline values win over styles/base.css, so the two have to agree. The
// rendered side of this -- that every visible element lands on a step of the
// ladder -- is asserted in e2e/top-row-layout.spec.ts, where there is a real
// layout to measure.

const uiSteps = ["xs", "sm", "md", "lg", "xl"] as const;

describe("ui type scale", () => {
  it("keeps the runtime scale in step with the stylesheet definitions", () => {
    const scale = uiZoomStyleVariables(1);

    // Mirrors the ladder documented in styles/base.css. `md` is the default:
    // it is the shell's base font-size and the size the menu bar renders at,
    // which is the baseline the rest of the UI is judged against.
    expect(scale["--font-ui-xs"]).toBe("10px");
    expect(scale["--font-ui-sm"]).toBe("11px");
    expect(scale["--font-ui-md"]).toBe("12px");
    expect(scale["--font-ui-lg"]).toBe("13px");
    expect(scale["--font-ui-xl"]).toBe("15px");
  });

  it("scales the whole ladder with UI zoom, keeping it strictly ordered", () => {
    for (const zoom of [0.8, 1, 1.25, 1.5]) {
      const scale = uiZoomStyleVariables(zoom);
      const steps = uiSteps.map((step) =>
        Number.parseFloat(scale[`--font-ui-${step}`]),
      );

      expect(steps.every((value) => Number.isFinite(value) && value > 0)).toBe(
        true,
      );
      for (let index = 1; index < steps.length; index += 1) {
        expect(steps[index]).toBeGreaterThan(steps[index - 1]);
      }
    }
  });
});
