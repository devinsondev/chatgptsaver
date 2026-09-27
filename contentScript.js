(() => {
  const SCRIPT_VERSION = "0.3.0";

  if (window.__chatGptChatSaverVersion === SCRIPT_VERSION) {
    return;
  }

  window.__chatGptChatSaverVersion = SCRIPT_VERSION;
  window.__chatGptChatSaverLoaded = true;

  const runtime = typeof browser !== "undefined" ? browser.runtime : chrome.runtime;
  const MESSAGE_TYPE = "chatgpt-saver:extract-v2";
  const CONTROL_MESSAGE_TYPE = "chatgpt-saver:control";
  const PROGRESS_MESSAGE_TYPE = "chatgpt-saver:progress";
  const MESSAGE_SELECTOR = "[data-message-author-role]";
  const MAX_SCROLL_STEPS = 420;
  const SUPPORTED_ROLES = new Set(["user", "assistant"]);
  const BLOCK_TAGS = new Set([
    "ADDRESS",
    "ARTICLE",
    "ASIDE",
    "BLOCKQUOTE",
    "DD",
    "DETAILS",
    "DIV",
    "DL",
    "DT",
    "FIELDSET",
    "FIGCAPTION",
    "FIGURE",
    "FOOTER",
    "FORM",
    "H1",
    "H2",
    "H3",
    "H4",
    "H5",
    "H6",
    "HEADER",
    "HR",
    "LI",
    "MAIN",
    "NAV",
    "OL",
    "P",
    "PRE",
    "SECTION",
    "TABLE",
    "TBODY",
    "TD",
    "TFOOT",
    "TH",
    "THEAD",
    "TR",
    "UL"
  ]);

  let activeScan = null;

  runtime.onMessage.addListener((message) => {
    if (!message || message.type !== MESSAGE_TYPE) {
      if (message?.type === CONTROL_MESSAGE_TYPE) {
        return controlActiveScan(message);
      }

      return undefined;
    }

    return extractConversation({
      jobId: message.jobId || "",
      scroll: message.scroll !== false
    });
  });

  function controlActiveScan(message) {
    if (!activeScan || message.jobId !== activeScan.jobId) {
      return Promise.resolve({ ok: false });
    }

    if (message.action === "finish") {
      activeScan.finishRequested = true;
      return Promise.resolve({ ok: true });
    }

    return Promise.resolve({ ok: false });
  }

  async function extractConversation({ jobId, scroll }) {
    const warnings = [];
    const collector = createMessageCollector();
    let scanStats = null;
    const scanControl = {
      jobId,
      finishRequested: false
    };
    activeScan = scanControl;

    try {
      if (scroll) {
        const scroller = findConversationScroller();
        const previousScroll = getScrollState(scroller);
        const addSnapshot = (stage, stats) => {
          const added = collector.add(readMessagesFromDom(), getScrollTop(scroller), stage);

          reportProgress(collector.size(), stage, scanControl, stats);

          return added;
        };

        try {
          scanStats = await deepScanScroller(scroller, addSnapshot, scanControl);
        } catch (error) {
          warnings.push("Scroll collection failed, so only the currently loaded DOM was captured.");
          addSnapshot("fallback");
        } finally {
          restoreScrollState(scroller, previousScroll);
        }
      } else {
        collector.add(readMessagesFromDom(), 0, "current");
      }
    } finally {
      if (activeScan === scanControl) {
        activeScan = null;
      }
    }

    const messages = collector.toMessages();

    if (messages.length === 0) {
      warnings.push("No ChatGPT messages were found on this page.");
    }

    if (scanStats?.capped) {
      warnings.push("Deep scan reached its safety limit; this very large chat may still be partial.");
    }

    if (scanStats?.finishedByUser) {
      warnings.push("Scan was finished manually; the result contains everything collected before that moment.");
    }

    return {
      ok: messages.length > 0,
      title: getConversationTitle(),
      url: location.href,
      host: location.host,
      extractedAt: new Date().toISOString(),
      scrolled: scroll,
      scanStats,
      messages,
      warnings
    };
  }

  async function deepScanScroller(scroller, addSnapshot, scanControl) {
    const viewportHeight = Math.max(getClientHeight(scroller), 500);
    const step = Math.max(Math.round(viewportHeight * 0.58), 320);
    const stats = {
      steps: 0,
      noNewSteps: 0,
      capped: false
    };

    await waitForDom(220);
    addSnapshot("current", stats);

    await sweepToEdge(scroller, "bottom", step, addSnapshot, stats, scanControl);
    await sweepToEdge(scroller, "top", step, addSnapshot, stats, scanControl);
    await sweepToEdge(scroller, "bottom", step, addSnapshot, stats, scanControl);

    return stats;
  }

  async function sweepToEdge(scroller, edge, step, addSnapshot, stats, scanControl) {
    let staleAtEdge = 0;
    let noNewInThisSweep = 0;

    while (stats.steps < MAX_SCROLL_STEPS && staleAtEdge < 5 && !scanControl.finishRequested) {
      const beforeTop = getScrollTop(scroller);
      const beforeMax = getMaxScroll(scroller);
      const target = edge === "top" ? Math.max(0, beforeTop - step) : Math.min(beforeMax, beforeTop + step);

      performScroll(scroller, target, edge, step);
      await waitForDom(190);

      const added = addSnapshot(edge, stats);
      const afterTop = getScrollTop(scroller);
      const afterMax = getMaxScroll(scroller);
      const atEdge = edge === "top" ? afterTop <= 2 : afterTop >= afterMax - 2;
      const moved = Math.abs(afterTop - beforeTop) > 2 || Math.abs(afterMax - beforeMax) > 2;

      if (added === 0) {
        stats.noNewSteps += 1;
        noNewInThisSweep += 1;
      } else {
        stats.noNewSteps = 0;
        noNewInThisSweep = 0;
      }

      if (atEdge && !moved && added === 0) {
        staleAtEdge += 1;
      } else {
        staleAtEdge = 0;
      }

      stats.steps += 1;

      if (noNewInThisSweep >= 70 && atEdge) {
        break;
      }
    }

    if (stats.steps >= MAX_SCROLL_STEPS) {
      stats.capped = true;
    }

    if (scanControl.finishRequested) {
      stats.finishedByUser = true;
    }
  }

  function createMessageCollector() {
    const messagesByKey = new Map();
    let sequence = 0;

    return {
      add(messages, scrollTop, stage) {
        let added = 0;

        for (const message of messages) {
          const key = getStableMessageKey(message);
          const order = scrollTop * 10000 + message.index;
          const existing = messagesByKey.get(key);

          if (existing) {
            existing.order = Math.min(existing.order, order);
            existing.lastStage = stage;

            if (message.content.length > existing.content.length) {
              existing.content = message.content;
            }
          } else {
            messagesByKey.set(key, {
              ...message,
              order,
              sequence,
              lastStage: stage
            });
            sequence += 1;
            added += 1;
          }
        }

        return added;
      },
      size() {
        return messagesByKey.size;
      },
      toMessages() {
        return Array.from(messagesByKey.values())
          .sort((a, b) => a.order - b.order || a.sequence - b.sequence)
          .map(({ id, role, content }, index) => ({
            id,
            role,
            index,
            content
          }));
      }
    };
  }

  function readMessagesFromDom() {
    const roleNodes = Array.from(document.querySelectorAll(MESSAGE_SELECTOR))
      .filter((node) => SUPPORTED_ROLES.has(node.getAttribute("data-message-author-role")))
      .filter((node) => !node.parentElement || !node.parentElement.closest(MESSAGE_SELECTOR));

    if (roleNodes.length > 0) {
      return roleNodes
        .map((node, index) => messageFromRoleNode(node, index))
        .filter((message) => message.content.length > 0);
    }

    return readMessagesFromFallbackTurns();
  }

  function messageFromRoleNode(node, index) {
    const role = node.getAttribute("data-message-author-role");
    const container = findMessageContainer(node);
    const content = extractReadableMarkdown(node);
    const id =
      node.getAttribute("data-message-id") ||
      container?.querySelector("[data-message-id]")?.getAttribute("data-message-id") ||
      "";

    return {
      id,
      role,
      index,
      content
    };
  }

  function readMessagesFromFallbackTurns() {
    const selectors = [
      "main article",
      "main [data-testid^='conversation-turn']",
      "[data-testid^='conversation-turn']"
    ];
    const turns = uniqueElements(selectors.flatMap((selector) => Array.from(document.querySelectorAll(selector))));

    return turns
      .map((turn, index) => {
        const role = inferRole(turn, index);
        const content = extractReadableMarkdown(turn);

        return {
          id: turn.getAttribute("data-message-id") || "",
          role,
          index,
          content
        };
      })
      .filter((message) => SUPPORTED_ROLES.has(message.role) && message.content.length > 0);
  }

  function inferRole(turn, index) {
    const roleNode = turn.querySelector(MESSAGE_SELECTOR);

    if (roleNode) {
      return roleNode.getAttribute("data-message-author-role");
    }

    const testId = `${turn.getAttribute("data-testid") || ""}`.toLowerCase();

    if (testId.includes("user")) {
      return "user";
    }

    if (testId.includes("assistant") || testId.includes("chatgpt")) {
      return "assistant";
    }

    return index % 2 === 0 ? "user" : "assistant";
  }

  function findMessageContainer(node) {
    return (
      node.closest("article") ||
      node.closest("[data-testid^='conversation-turn']") ||
      node.closest("main > div") ||
      node
    );
  }

  function extractReadableMarkdown(root) {
    const clone = root.cloneNode(true);
    pruneClone(clone);

    return cleanupMarkdown(markdownFromNode(clone, { inPre: false, inCode: false }));
  }

  function pruneClone(root) {
    const removableSelectors = [
      "button",
      "svg",
      "style",
      "script",
      "noscript",
      "template",
      "form",
      "textarea",
      "input",
      "select",
      "[hidden]",
      "[aria-hidden='true']",
      "[data-testid*='copy']",
      "[data-testid*='feedback']",
      "[data-testid*='turn-action']",
      "[data-testid*='composer']",
      "[contenteditable='true']"
    ];

    for (const element of Array.from(root.querySelectorAll(removableSelectors.join(",")))) {
      element.remove();
    }
  }

  function markdownFromNode(node, context) {
    if (node.nodeType === Node.TEXT_NODE) {
      return context.inPre ? node.textContent : node.textContent.replace(/\s+/g, " ");
    }

    if (node.nodeType !== Node.ELEMENT_NODE) {
      return "";
    }

    const element = node;
    const tag = element.tagName;

    if (tag === "BR") {
      return "\n";
    }

    if (tag === "HR") {
      return "\n\n---\n\n";
    }

    if (tag === "IMG") {
      const alt = element.getAttribute("alt") || "image";
      const source = element.getAttribute("src") || "";
      return source ? `![${alt}](${source})` : `[${alt}]`;
    }

    if (tag === "PRE") {
      const codeNode = element.querySelector("code") || element;
      const language = detectLanguage(codeNode);
      const code = codeNode.textContent.replace(/\n+$/g, "");
      return `\n\n\`\`\`${language}\n${code}\n\`\`\`\n\n`;
    }

    if (tag === "CODE" && !context.inPre) {
      const code = element.textContent.replace(/\s+/g, " ").trim();
      return code ? `\`${code.replace(/`/g, "\\`")}\`` : "";
    }

    if (tag === "A") {
      const text = childMarkdown(element, context).trim();
      const href = element.getAttribute("href");

      if (!href || !text || href === text) {
        return text || href || "";
      }

      return `[${text}](${href})`;
    }

    if (/^H[1-6]$/.test(tag)) {
      const level = Number(tag.slice(1));
      const text = childMarkdown(element, context).trim();
      return text ? `\n\n${"#".repeat(level)} ${text}\n\n` : "";
    }

    if (tag === "LI") {
      const text = childMarkdown(element, context).trim();
      return text ? `\n- ${text}\n` : "";
    }

    if (tag === "TR") {
      const cells = Array.from(element.children)
        .filter((child) => child.tagName === "TD" || child.tagName === "TH")
        .map((child) => childMarkdown(child, context).trim());

      return cells.length > 0 ? `\n| ${cells.join(" | ")} |\n` : "";
    }

    const text = childMarkdown(element, context);

    if (BLOCK_TAGS.has(tag)) {
      return `\n${text}\n`;
    }

    return text;
  }

  function childMarkdown(element, context) {
    return Array.from(element.childNodes)
      .map((child) => markdownFromNode(child, context))
      .join("");
  }

  function detectLanguage(codeNode) {
    const className = codeNode.getAttribute?.("class") || "";
    const match = className.match(/language-([a-z0-9_-]+)/i);

    return match ? match[1] : "";
  }

  function cleanupMarkdown(text) {
    return text
      .replace(/\u00a0/g, " ")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n[ \t]+/g, "\n")
      .replace(/[ \t]{2,}/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  function findConversationScroller() {
    const messageScroller = findScrollerFromVisibleMessages();

    if (messageScroller) {
      return messageScroller;
    }

    const scrollingElement = document.scrollingElement || document.documentElement;
    const candidates = [scrollingElement, document.body, ...Array.from(document.querySelectorAll("main, main *"))];
    let best = window;
    let bestScore = getMaxScroll(window) * window.innerWidth;

    for (const element of candidates) {
      if (!element || element === document.body && document.body === scrollingElement) {
        continue;
      }

      const overflowY = getComputedStyle(element).overflowY;
      const canScroll = /(auto|scroll|overlay)/.test(overflowY) || element.scrollHeight > element.clientHeight + 120;

      if (!canScroll || element.clientHeight < 250 || element.clientWidth < 320) {
        continue;
      }

      const score = (element.scrollHeight - element.clientHeight) * element.clientWidth;

      if (score > bestScore) {
        best = element;
        bestScore = score;
      }
    }

    return best;
  }

  function findScrollerFromVisibleMessages() {
    const messageNode = document.querySelector(MESSAGE_SELECTOR);

    if (!messageNode) {
      return null;
    }

    let best = null;
    let bestScore = 0;

    for (let element = messageNode.parentElement; element; element = element.parentElement) {
      if (element === document.body || element === document.documentElement) {
        break;
      }

      if (isElementScrollable(element)) {
        const messageCount = element.querySelectorAll(MESSAGE_SELECTOR).length;
        const scrollRange = Math.max(0, element.scrollHeight - element.clientHeight);
        const score = scrollRange * Math.max(element.clientWidth, 1) + messageCount * 1000000;

        if (score > bestScore) {
          best = element;
          bestScore = score;
        }
      }
    }

    return best || window;
  }

  function isElementScrollable(element) {
    const style = getComputedStyle(element);
    const canScrollByStyle = /(auto|scroll|overlay)/.test(style.overflowY);
    const hasScrollableArea = element.scrollHeight > element.clientHeight + 120;
    const containsConversation = element.querySelectorAll(MESSAGE_SELECTOR).length >= 2 || element.tagName === "MAIN";

    return hasScrollableArea && (canScrollByStyle || containsConversation) && element.clientHeight > 250;
  }

  function getScrollState(scroller) {
    if (scroller === window) {
      return {
        top: window.scrollY,
        left: window.scrollX
      };
    }

    return {
      top: scroller.scrollTop,
      left: scroller.scrollLeft
    };
  }

  function restoreScrollState(scroller, state) {
    if (scroller === window) {
      window.scrollTo(state.left, state.top);
      return;
    }

    scroller.scrollTo({
      left: state.left,
      top: state.top,
      behavior: "auto"
    });
  }

  function getMaxScroll(scroller) {
    if (scroller === window) {
      const element = document.scrollingElement || document.documentElement;
      return Math.max(0, element.scrollHeight - window.innerHeight);
    }

    return Math.max(0, scroller.scrollHeight - scroller.clientHeight);
  }

  function getScrollTop(scroller) {
    if (scroller === window) {
      return window.scrollY;
    }

    return scroller.scrollTop;
  }

  function getClientHeight(scroller) {
    return scroller === window ? window.innerHeight : scroller.clientHeight;
  }

  function setScrollTop(scroller, top) {
    if (scroller === window) {
      window.scrollTo({
        top,
        behavior: "auto"
      });
      return;
    }

    scroller.scrollTo({
      top,
      behavior: "auto"
    });
  }

  function performScroll(scroller, target, edge, step) {
    const delta = edge === "top" ? -step : step;

    setScrollTop(scroller, target);
    dispatchWheel(scroller, delta);
    dispatchScroll(scroller);
  }

  function dispatchWheel(scroller, deltaY) {
    const target = scroller === window ? document.scrollingElement || document.documentElement : scroller;

    target.dispatchEvent(new WheelEvent("wheel", {
      bubbles: true,
      cancelable: true,
      deltaMode: WheelEvent.DOM_DELTA_PIXEL,
      deltaY
    }));
  }

  function dispatchScroll(scroller) {
    const target = scroller === window ? window : scroller;

    target.dispatchEvent(new Event("scroll", {
      bubbles: true
    }));
  }

  function waitForDom(delay) {
    return new Promise((resolve) => {
      window.setTimeout(resolve, delay);
    });
  }

  function reportProgress(count, stage, scanControl, stats) {
    try {
      const result = runtime.sendMessage({
        type: PROGRESS_MESSAGE_TYPE,
        jobId: scanControl.jobId,
        count,
        stage,
        steps: stats?.steps || 0
      });

      if (result?.catch) {
        result.catch(() => {});
      }
    } catch (error) {
      // Popup may be closed; progress reporting is best effort only.
    }
  }

  function getStableMessageKey(message) {
    if (message.id) {
      return `${message.role}:${message.id}`;
    }

    return `${message.role}:${hashText(message.content)}`;
  }

  function hashText(text) {
    let hash = 5381;

    for (let index = 0; index < text.length; index += 1) {
      hash = (hash * 33) ^ text.charCodeAt(index);
    }

    return `${hash >>> 0}:${text.length}`;
  }

  function uniqueElements(elements) {
    return Array.from(new Set(elements));
  }

  function getConversationTitle() {
    const heading =
      document.querySelector("main h1")?.textContent ||
      document.querySelector("title")?.textContent ||
      document.title ||
      "ChatGPT conversation";

    return heading
      .replace(/\s*[|-]\s*ChatGPT\s*$/i, "")
      .replace(/\s+/g, " ")
      .trim() || "ChatGPT conversation";
  }
})();
