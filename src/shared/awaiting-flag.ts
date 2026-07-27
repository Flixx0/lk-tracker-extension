const FLAG = "data-lk-awaiting-send";

function setFlagOnDocument(doc: Document, on: boolean): void {
  if (on) {
    doc.documentElement.setAttribute(FLAG, "1");
  } else {
    doc.documentElement.removeAttribute(FLAG);
  }
}

/** Synchronise le flag sur cette frame, le parent et les iframes same-origin */
export function setAwaitingSendFlag(on: boolean): void {
  setFlagOnDocument(document, on);

  try {
    if (window.parent !== window) {
      setFlagOnDocument(window.parent.document, on);
    }
  } catch {
    /* cross-origin */
  }

  try {
    for (let i = 0; i < window.frames.length; i++) {
      try {
        setFlagOnDocument(window.frames[i].document, on);
      } catch {
        /* cross-origin */
      }
    }
  } catch {
    /* ignore */
  }
}
