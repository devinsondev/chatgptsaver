const formats = globalThis.ChatGptSaverFormats;
const titleElement = document.getElementById("title");
const noticeElement = document.getElementById("notice");
const metaElement = document.getElementById("meta");
const messagesElement = document.getElementById("messages");
const emptyElement = document.getElementById("empty");
const markdownButton = document.getElementById("downloadMarkdown");
const htmlButton = document.getElementById("downloadHtml");
const copyButton = document.getElementById("copyMarkdown");

let exportData = null;

markdownButton.addEventListener("click", () => downloadCurrent("md"));
htmlButton.addEventListener("click", () => downloadCurrent("html"));
copyButton.addEventListener("click", copyMarkdown);

loadPreview();

async function loadPreview() {
  const stored = await browser.storage.local.get("latestExport");
  exportData = stored.latestExport;

  if (!exportData?.messages?.length) {
    emptyElement.hidden = false;
    messagesElement.hidden = true;
    markdownButton.disabled = true;
    htmlButton.disabled = true;
    copyButton.disabled = true;
    return;
  }

  renderExport(exportData);
}

function renderExport(data) {
  titleElement.textContent = data.title || "ChatGPT conversation";
  metaElement.textContent = `${data.messages.length} сообщений · ${formats.formatDate(data.extractedAt)} · ${data.url || "unknown source"}`;
  messagesElement.replaceChildren(...data.messages.map(createMessageElement));
}

function createMessageElement(message, index) {
  const article = document.createElement("article");
  article.className = `message ${message.role === "user" ? "user" : "assistant"}`;

  const header = document.createElement("header");
  const role = document.createElement("span");
  role.className = "role";
  role.textContent = formats.getRoleLabel(message.role);

  const number = document.createElement("span");
  number.className = "number";
  number.textContent = `#${index + 1}`;

  const body = document.createElement("pre");
  body.textContent = (message.content || "").trim();

  header.append(role, number);
  article.append(header, body);

  return article;
}

async function downloadCurrent(extension) {
  if (!exportData) {
    return;
  }

  setNotice("Сохраняю файл...");

  const isHtml = extension === "html";
  const text = isHtml ? formats.makeHtml(exportData) : formats.makeMarkdown(exportData);
  const filename = formats.makeFilename(exportData, extension);
  const type = isHtml ? "text/html;charset=utf-8" : "text/markdown;charset=utf-8";

  try {
    await downloadText(text, filename, type);
    setNotice("Готово, Firefox открыл сохранение файла.");
  } catch (error) {
    setNotice(error.message || "Firefox не дал сохранить файл.");
  }
}

async function copyMarkdown() {
  if (!exportData) {
    return;
  }

  await navigator.clipboard.writeText(formats.makeMarkdown(exportData));
  copyButton.textContent = "Скопировано";
  window.setTimeout(() => {
    copyButton.textContent = "Копировать";
  }, 1200);
}

async function downloadText(text, filename, type) {
  return browser.runtime.sendMessage({
    type: "chatgpt-saver:download",
    text,
    filename,
    mimeType: type
  });
}

function setNotice(text) {
  noticeElement.textContent = text;
  noticeElement.hidden = false;
}
