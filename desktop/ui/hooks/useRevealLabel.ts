import { getPlatformServices } from "../platform";

const platformName = getPlatformServices().window.getPlatformName();

export const REVEAL_LABEL =
  platformName === "macos"
    ? "Reveal in macOS Finder"
    : platformName === "windows"
      ? "Reveal in Windows Explorer"
      : "Reveal in File Manager";
