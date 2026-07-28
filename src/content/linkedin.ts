import { initProfileTracking } from "./profile";
import { initConnections } from "./connections";
import { initMessaging } from "./messaging";
import { isExtensionContextValid } from "../shared/extension-context";

initProfileTracking();

if (location.pathname.includes("/mynetwork")) {
  initConnections();
}

if (location.pathname.includes("/messaging")) {
  initMessaging();
}

console.log("[LK Tracker] Extension active sur", location.pathname);

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
    if (location.pathname.includes("/mynetwork")) {
      initConnections();
    }
    if (location.pathname.includes("/messaging")) {
      initMessaging();
    }
  }
}, 1000);
