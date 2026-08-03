/**
 * Script injecté dans le monde MAIN (page LinkedIn).
 * Intercepte fetch/XHR, clics et toast « Invitation envoyée à… ».
 */
import {
  installInvitationToastWatcher,
} from "../shared/invitation-toast";

(function () {
  const win = window as Window & { __lkPageBridge?: boolean };
  if (win.__lkPageBridge) return;
  win.__lkPageBridge = true;

  const FLAG = "data-lk-awaiting-send";

  function isInvitationSendRequest(url: string, method: string, body: string): boolean {
    const m = method.toUpperCase();
    if (m !== "POST") return false;

    const u = url.toLowerCase();
    const b = body.toLowerCase();

    if (u.includes("/relationships/invitations")) return true;
    if (u.includes("voyager") && u.includes("invitation")) return true;

    if (u.includes("graphql") || u.includes("graph")) {
      if (b.includes("invitation") && (b.includes("create") || b.includes("send") || b.includes("action"))) {
        return true;
      }
      if (b.includes("connect") && b.includes("invitation")) return true;
      if (b.includes("memberrelationship") && b.includes("connect")) return true;
    }

    return false;
  }

  function emit(name: string, detail?: Record<string, string>): void {
    document.dispatchEvent(
      new CustomEvent(name, { bubbles: true, composed: true, cancelable: false, detail })
    );
  }

  function hasAwaitingFlag(doc: Document): boolean {
    return doc.documentElement.hasAttribute(FLAG);
  }

  function isInviteContext(): boolean {
    if (location.pathname.includes("custom-invite")) return true;
    if (hasAwaitingFlag(document)) return true;

    try {
      if (window.parent !== window && hasAwaitingFlag(window.parent.document)) return true;
    } catch {
      /* cross-origin */
    }

    return false;
  }

  function textLooksLikeSend(text: string): boolean {
    const t = text.trim();
    if (!t || t.length > 120) return false;
    const n = t.toLowerCase().replace(/\s+/g, " ");
    if (n === "envoyer" || n === "send") return true;
    if (n.includes("envoyer sans") || n.includes("sans note")) return true;
    if (n.includes("send without")) return true;
    return false;
  }

  function nodeLooksLikeSend(node: EventTarget): boolean {
    if (!(node instanceof HTMLElement)) return false;

    const aria = node.getAttribute("aria-label") ?? "";
    if (textLooksLikeSend(aria)) return true;

    const inner = (node.innerText ?? "").trim();
    if (textLooksLikeSend(inner)) return true;

    return false;
  }

  function findSendInEvent(event: Event): boolean {
    for (const node of event.composedPath()) {
      if (nodeLooksLikeSend(node)) return true;

      if (node instanceof HTMLElement) {
        let el: HTMLElement | null = node;
        for (let depth = 0; depth < 10 && el; depth++) {
          const block = (el.innerText ?? "").trim();
          if (block.length <= 200 && textLooksLikeSend(block)) return true;
          el = el.parentElement;
        }
      }
    }
    return false;
  }

  function onUserAction(event: Event): void {
    if (!isInviteContext()) return;
    if (!findSendInEvent(event)) return;
    emit("lk-send-invite-click");
  }

  const originalFetch = window.fetch.bind(window);
  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    try {
      let url = "";
      let method = init?.method ?? "GET";
      let body = "";

      if (input instanceof Request) {
        url = input.url;
        method = input.method;
      } else {
        url = String(input);
      }

      if (init?.body && typeof init.body === "string") body = init.body;
      if (isInvitationSendRequest(url, method, body)) emit("lk-invitation-api");
    } catch {
      /* ignore */
    }

    return originalFetch(input, init);
  };

  type XhrWithMeta = XMLHttpRequest & { _lkMethod?: string; _lkUrl?: string };
  const xhrProto = XMLHttpRequest.prototype;
  const origOpen = xhrProto.open;
  const origSend = xhrProto.send;

  xhrProto.open = function (
    this: XhrWithMeta,
    method: string,
    url: string | URL,
    async?: boolean,
    username?: string | null,
    password?: string | null
  ) {
    this._lkMethod = method;
    this._lkUrl = String(url);
    return origOpen.call(this, method, url, async ?? true, username, password);
  };

  xhrProto.send = function (this: XhrWithMeta, body?: Document | XMLHttpRequestBodyInit | null) {
    try {
      const bodyStr = typeof body === "string" ? body : "";
      if (isInvitationSendRequest(this._lkUrl ?? "", this._lkMethod ?? "GET", bodyStr)) {
        emit("lk-invitation-api");
      }
    } catch {
      /* ignore */
    }
    return origSend.call(this, body);
  };

  window.addEventListener("pointerdown", onUserAction, true);

  /** Actions DOM demandées par le content script (scroll/clic messagerie) — contexte page. */
  window.addEventListener("message", (event: MessageEvent) => {
    if (event.source !== window) return;
    const data = event.data as {
      source?: string;
      type?: string;
    } | null;
    if (!data || data.source !== "lk-tracker") return;

    if (data.type === "DOM_CLICK") {
      const el = document.querySelector<HTMLElement>("[data-lk-target='1']");
      if (!el) return;
      el.removeAttribute("data-lk-target");
      const rect = el.getBoundingClientRect();
      const x = rect.left + Math.min(rect.width / 2, 40);
      const y = rect.top + Math.min(rect.height / 2, 24);
      const base = {
        bubbles: true,
        cancelable: true,
        view: window,
        clientX: x,
        clientY: y,
        screenX: x,
        screenY: y,
        button: 0,
        buttons: 1,
      };
      try {
        el.focus?.();
        el.dispatchEvent(
          new PointerEvent("pointerdown", {
            ...base,
            pointerId: 1,
            pointerType: "mouse",
            isPrimary: true,
          })
        );
        el.dispatchEvent(new MouseEvent("mousedown", base));
        el.dispatchEvent(
          new PointerEvent("pointerup", {
            ...base,
            pointerId: 1,
            pointerType: "mouse",
            isPrimary: true,
            buttons: 0,
          })
        );
        el.dispatchEvent(new MouseEvent("mouseup", { ...base, buttons: 0 }));
        el.dispatchEvent(new MouseEvent("click", { ...base, buttons: 0 }));
        el.click();
      } catch (err) {
        console.warn("[LK Tracker] page bridge click:", err);
      }
      return;
    }

    if (data.type === "DOM_SCROLL") {
      const el = document.querySelector<HTMLElement>("[data-lk-scroll='1']");
      if (!el) return;
      try {
        const before = el.scrollTop;
        el.scrollTop = el.scrollHeight;
        if (el.scrollTop === before) {
          el.scrollBy({ top: Math.max(el.clientHeight * 0.85, 400), behavior: "instant" as ScrollBehavior });
        }
        el.dispatchEvent(new Event("scroll", { bubbles: true }));
        window.dispatchEvent(new Event("scroll", { bubbles: true }));
      } catch (err) {
        console.warn("[LK Tracker] page bridge scroll:", err);
      }
    }
  });

  if (window === window.top) {
    installInvitationToastWatcher((text) => {
      emit("lk-invitation-toast", { text });
    });
  }

  console.log(
    "[LK Tracker] Page bridge",
    window === window.top ? "top" : "iframe",
    location.pathname
  );
})();
