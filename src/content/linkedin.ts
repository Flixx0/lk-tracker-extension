import { initProfileTracking } from "./profile";
import { initConnections } from "./connections";
import { initMessaging } from "./messaging";
import { isExtensionContextValid } from "../shared/extension-context";

/** La sync messagerie/connexions doit tourner dans le top frame (Arc injecte des iframes). */
const isTopFrame = window === window.top;

initProfileTracking();

if (isTopFrame && location.pathname.includes("/mynetwork")) {
  initConnections();
}

if (isTopFrame && location.pathname.includes("/messaging")) {
  initMessaging();
}

console.log(
  "[LK Tracker] Extension active sur",
  location.pathname,
  isTopFrame ? "(top)" : "(iframe)"
);

let lastUrl = location.href;
const navigationTimer = setInterval(() => {
  if (!isExtensionContextValid()) {
    clearInterval(navigationTimer);
    return;
  }
  if (location.href !== lastUrl) {
    lastUrl = location.href;
    console.log("[LK Tracker] Navigation →", location.pathname);
    initProfileTracking();
    if (isTopFrame && location.pathname.includes("/mynetwork")) {
      initConnections();
    }
    if (isTopFrame && location.pathname.includes("/messaging")) {
      initMessaging();
    }
  }
}, 1000);
