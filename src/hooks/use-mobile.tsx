import * as React from "react";

function detectMobileDevice() {
  if (typeof window === "undefined") return false;

  const nav = window.navigator;
  const ua = nav.userAgent || "";
  const platform = nav.platform || "";
  const handheldUa =
    /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini|Mobile|Tablet/i.test(ua);
  const iPadDesktopMode = platform === "MacIntel" && nav.maxTouchPoints > 1;
  const coarsePointer = window.matchMedia?.("(pointer: coarse)").matches ?? false;
  const noHover = window.matchMedia?.("(hover: none)").matches ?? false;
  const shortestScreenSide = Math.min(
    window.screen.width || window.innerWidth,
    window.screen.height || window.innerHeight,
  );

  return handheldUa || iPadDesktopMode || (coarsePointer && noHover && shortestScreenSide <= 932);
}

export function useIsMobile() {
  const [isMobile, setIsMobile] = React.useState(false);

  React.useEffect(() => {
    const mql = window.matchMedia("(pointer: coarse)");
    const onChange = () => {
      setIsMobile(detectMobileDevice());
    };
    mql.addEventListener("change", onChange);
    window.addEventListener("resize", onChange);
    window.addEventListener("orientationchange", onChange);
    setIsMobile(detectMobileDevice());
    return () => {
      mql.removeEventListener("change", onChange);
      window.removeEventListener("resize", onChange);
      window.removeEventListener("orientationchange", onChange);
    };
  }, []);

  return isMobile;
}

export function useDeviceType() {
  return useIsMobile() ? "mobile" : "desktop";
}
