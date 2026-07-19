// Platform detection for keyboard behavior (Mod = Cmd on macOS, Ctrl
// elsewhere).
//
// `navigator.platform` is deprecated — the spec allows returning the empty
// string, and WebView engines are free to change what it reports, which would
// silently flip every Cmd/Ctrl binding. So detection prefers the
// standards-track `navigator.userAgentData.platform` and only falls back
// through `navigator.platform` to the user-agent string.

/**
 * The subset of `Navigator` the detection reads. `userAgentData` is not in the
 * DOM lib yet (still experimental), hence the local typing; every field is
 * optional so tests can inject minimal fakes.
 */
export type PlatformNavigator = {
  userAgentData?: { platform?: string };
  platform?: string;
  userAgent?: string;
};

/** True for macOS and iOS (where the primary modifier is Cmd, not Ctrl). */
export function detectMacPlatform(nav: PlatformNavigator | undefined): boolean {
  if (!nav) {
    return false;
  }
  const uaDataPlatform = nav.userAgentData?.platform;
  if (uaDataPlatform) {
    return /mac|iphone|ipad|ipod|ios/i.test(uaDataPlatform);
  }
  if (nav.platform) {
    return /Mac|iPhone|iPad|iPod/.test(nav.platform);
  }
  return /Macintosh|Mac OS X|iPhone|iPad|iPod/.test(nav.userAgent ?? "");
}

export const isMac = detectMacPlatform(
  typeof navigator === "undefined" ? undefined : navigator,
);
