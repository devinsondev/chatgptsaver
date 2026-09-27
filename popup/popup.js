const stateElement = document.getElementById("state");
const summaryElement = document.getElementById("summary");
const warningElement = document.getElementById("warning");
const collectButton = document.getElementById("collect");
const finishScanButton = document.getElementById("finishScan");
const previewButton = document.getElementById("preview");
const markdownButton = document.getElementById("downloadMarkdown");
const htmlButton = document.getElementById("downloadHtml");
const copyButton = document.getElementById("copyMarkdown");
const formats = globalThis.ChatGptSaverFormats;

let currentExport = null;

collectButton.addEventListener("click", collectCurrentChat);
finishScanButton.addEventListener("click", finishScanNow);
previewButton.addEventListener("click", openPreview);
markdownButton.addEventListener("click", () => downloadCurrent("md"));
htmlButton.addEventListener("click", () => downloadCurrent("html"));
copyButton.addEventListener("click", copyMarkdown);

browser.runtime.onMessage.addListener((message) => {
  if (message?.type !== "chatgpt-saver:scan-status") {
    return undefined;
  }

  applyScanState(message.state);

  return undefined;
});

restoreScanState();

async function restoreScanState() {
  try {
    const state = await browser.runtime.sendMessage({
      type: "chatgpt-saver:get-scan-state"
    });
    applyScanState(state);
  } catch (error) {
    showWarning(error.message || "Не удалось прочитать состояние аддона.");
  }
}

async function collectCurrentChat() {
  hideWarning();
  setRunningState({
    count: 0,
    stage: "start"
  });

  try {
    const state = await browser.runtime.sendMessage({
      type: "chatgpt-saver:start-scan"
    });
    applyScanState(state);
  } catch (error) {
    stateElement.textContent = "ошибка";
    collectButton.disabled = false;
    collectButton.textContent = "Собрать текущий чат";
    finishScanButton.hidden = true;
    showWarning(error.message || "Не удалось начать сбор чата.");
  }
}

async function finishScanNow() {
  finishScanButton.disabled = true;
  finishScanButton.textContent = "Завершаю...";
  summaryElement.textContent = "Останавливаю скан и забираю уже найденные сообщения...";

  try {
    const state = await browser.runtime.sendMessage({
      type: "chatgpt-saver:finish-scan"
    });
    applyScanState(state);
  } catch (error) {
    finishScanButton.disabled = false;
    finishScanButton.textContent = "Завершить сейчас";
    showWarning(error.message || "Не удалось остановить скан.");
  }
}

function applyScanState(state) {
  if (!state) {
    return;
  }

  hideWarning();

  if (state.status === "running") {
    setRunningState(state);
    return;
  }

  if (state.status === "done" && state.result?.messages?.length) {
    setCurrentExport(state.result);
    stateElement.textContent = "готов";
    collectButton.disabled = false;
    collectButton.textContent = "Собрать текущий чат";
    finishScanButton.hidden = true;
    finishScanButton.disabled = false;
    finishScanButton.textContent = "Завершить сейчас";

    if (state.result.warnings?.length) {
      showWarning(state.result.warnings.join(" "));
    }
    return;
  }

  if (state.status === "error") {
    stateElement.textContent = "ошибка";
    collectButton.disabled = false;
    collectButton.textContent = "Собрать текущий чат";
    finishScanButton.hidden = true;
    finishScanButton.disabled = false;
    finishScanButton.textContent = "Завершить сейчас";
    showWarning(state.error || "Не удалось собрать чат.");
    return;
  }

  stateElement.textContent = "готов";
  collectButton.disabled = false;
  collectButton.textContent = "Собрать текущий чат";
  finishScanButton.hidden = true;
  finishScanButton.disabled = false;
  finishScanButton.textContent = "Завершить сейчас";
}

function setRunningState(state) {
  stateElement.textContent = "собираю";
  collectButton.disabled = true;
  collectButton.textContent = "Сканирую чат...";
  finishScanButton.hidden = false;
  finishScanButton.disabled = state.stage === "finishing";
  finishScanButton.textContent = state.stage === "finishing" ? "Завершаю..." : "Завершить сейчас";
  setActionButtonsEnabled(false);

  const label = getStageLabel(state.stage);
  summaryElement.textContent = `${label} найдено ${state.count || 0} сообщений. Popup можно закрыть, сбор продолжится.`;
}

function getStageLabel(stage) {
  if (stage === "top") {
    return "Иду вверх по чату,";
  }

  if (stage === "bottom") {
    return "Иду вниз по чату,";
  }

  if (stage === "finishing") {
    return "Завершаю скан,";
  }

  return "Глубоко сканирую чат,";
}

function setCurrentExport(exportData) {
  currentExport = exportData;
  const userCount = exportData.messages.filter((message) => message.role === "user").length;
  const assistantCount = exportData.messages.filter((message) => message.role === "assistant").length;

  summaryElement.textContent = `${exportData.messages.length} сообщений: ${userCount} ваших, ${assistantCount} ответов ChatGPT.`;
  setActionButtonsEnabled(true);
}

function setActionButtonsEnabled(enabled) {
  previewButton.disabled = !enabled;
  markdownButton.disabled = !enabled;
  htmlButton.disabled = !enabled;
  copyButton.disabled = !enabled;
}

async function openPreview() {
  if (!currentExport) {
    return;
  }

  await browser.storage.local.set({ latestExport: currentExport });
  await browser.tabs.create({
    url: browser.runtime.getURL("preview/preview.html")
  });
}

async function downloadCurrent(extension) {
  if (!currentExport) {
    return;
  }

  stateElement.textContent = "сохраняю";
  hideWarning();

  const isHtml = extension === "html";
  const text = isHtml ? formats.makeHtml(currentExport) : formats.makeMarkdown(currentExport);
  const filename = formats.makeFilename(currentExport, extension);
  const type = isHtml ? "text/html;charset=utf-8" : "text/markdown;charset=utf-8";

  try {
    await downloadText(text, filename, type);
    stateElement.textContent = "готов";
  } catch (error) {
    stateElement.textContent = "ошибка";
    showWarning(error.message || "Firefox не дал сохранить файл.");
  }
}

async function copyMarkdown() {
  if (!currentExport) {
    return;
  }

  await navigator.clipboard.writeText(formats.makeMarkdown(currentExport));
  stateElement.textContent = "скопировано";
  window.setTimeout(() => {
    stateElement.textContent = "готов";
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

function showWarning(text) {
  warningElement.textContent = text;
  warningElement.hidden = false;
}

function hideWarning() {
  warningElement.textContent = "";
  warningElement.hidden = true;
}
