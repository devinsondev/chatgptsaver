(function exposeFormatters(global) {
  const ROLE_LABELS = {
    user: "You",
    assistant: "ChatGPT"
  };

  function makeMarkdown(exportData) {
    const title = exportData.title || "ChatGPT conversation";
    const savedAt = formatDate(exportData.extractedAt);
    const lines = [
      `# ${title}`,
      "",
      `Source: ${exportData.url || "unknown"}`,
      `Saved: ${savedAt}`,
      `Messages: ${exportData.messages.length}`,
      ""
    ];

    for (const [index, message] of exportData.messages.entries()) {
      lines.push(`## ${index + 1}. ${getRoleLabel(message.role)}`);
      lines.push("");
      lines.push((message.content || "").trim());
      lines.push("");
    }

    return `${lines.join("\n").replace(/\n{3,}/g, "\n\n").trim()}\n`;
  }

  function makeHtml(exportData) {
    const title = exportData.title || "ChatGPT conversation";
    const savedAt = formatDate(exportData.extractedAt);
    const messages = exportData.messages
      .map((message, index) => {
        const role = getRoleLabel(message.role);
        const roleClass = message.role === "user" ? "user" : "assistant";

        return [
          `<article class="message ${roleClass}">`,
          `<header><span>${escapeHtml(role)}</span><small>#${index + 1}</small></header>`,
          `<pre>${escapeHtml((message.content || "").trim())}</pre>`,
          "</article>"
        ].join("\n");
      })
      .join("\n");

    return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <style>
    :root {
      color-scheme: light dark;
      --bg: #f6f4ee;
      --text: #1f2933;
      --muted: #65717c;
      --line: #d8d5ca;
      --user: #dfeee7;
      --assistant: #ffffff;
      --accent: #226a76;
    }
    @media (prefers-color-scheme: dark) {
      :root {
        --bg: #17191c;
        --text: #edf0f2;
        --muted: #a9b0b7;
        --line: #343941;
        --user: #17382f;
        --assistant: #22262b;
        --accent: #77ccd6;
      }
    }
    body {
      margin: 0;
      background: var(--bg);
      color: var(--text);
      font: 15px/1.55 ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    main {
      width: min(920px, calc(100% - 32px));
      margin: 0 auto;
      padding: 32px 0 56px;
    }
    h1 {
      margin: 0 0 8px;
      font-size: clamp(24px, 4vw, 38px);
      line-height: 1.15;
      letter-spacing: 0;
    }
    .meta {
      margin: 0 0 28px;
      color: var(--muted);
    }
    .message {
      border: 1px solid var(--line);
      border-radius: 8px;
      margin: 16px 0;
      overflow: hidden;
      background: var(--assistant);
    }
    .message.user {
      background: var(--user);
    }
    .message header {
      align-items: center;
      border-bottom: 1px solid var(--line);
      display: flex;
      justify-content: space-between;
      padding: 10px 14px;
      color: var(--accent);
      font-weight: 700;
    }
    .message small {
      color: var(--muted);
      font-weight: 500;
    }
    pre {
      margin: 0;
      padding: 16px 14px;
      white-space: pre-wrap;
      word-wrap: break-word;
      font: inherit;
    }
  </style>
</head>
<body>
  <main>
    <h1>${escapeHtml(title)}</h1>
    <p class="meta">Saved ${escapeHtml(savedAt)} from ${escapeHtml(exportData.url || "unknown")} · ${exportData.messages.length} messages</p>
    ${messages}
  </main>
</body>
</html>
`;
  }

  function makeFilename(exportData, extension) {
    const date = new Date(exportData.extractedAt || Date.now());
    const stamp = [
      date.getFullYear(),
      pad(date.getMonth() + 1),
      pad(date.getDate()),
      pad(date.getHours()),
      pad(date.getMinutes())
    ].join("-");
    const title = sanitizeFilename(exportData.title || "chatgpt-chat").slice(0, 80);

    return `${title || "chatgpt-chat"}-${stamp}.${extension}`;
  }

  function getRoleLabel(role) {
    return ROLE_LABELS[role] || role || "Message";
  }

  function formatDate(value) {
    const date = value ? new Date(value) : new Date();

    if (Number.isNaN(date.getTime())) {
      return "unknown date";
    }

    return date.toLocaleString();
  }

  function sanitizeFilename(value) {
    return value
      .toLowerCase()
      .replace(/[^a-z0-9а-яё._ -]+/gi, "")
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^[.-]+|[.-]+$/g, "");
  }

  function escapeHtml(value) {
    return `${value}`
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function pad(value) {
    return `${value}`.padStart(2, "0");
  }

  global.ChatGptSaverFormats = {
    escapeHtml,
    formatDate,
    getRoleLabel,
    makeFilename,
    makeHtml,
    makeMarkdown
  };
})(globalThis);
