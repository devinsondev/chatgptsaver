const DOWNLOAD_MESSAGE_TYPE = "chatgpt-saver:download";
const START_SCAN_MESSAGE_TYPE = "chatgpt-saver:start-scan";
const GET_SCAN_STATE_MESSAGE_TYPE = "chatgpt-saver:get-scan-state";
const FINISH_SCAN_MESSAGE_TYPE = "chatgpt-saver:finish-scan";
const PROGRESS_MESSAGE_TYPE = "chatgpt-saver:progress";
const STATUS_MESSAGE_TYPE = "chatgpt-saver:scan-status";

const scanState = {
  status: "idle",
  jobId: "",
  tabId: null,
  count: 0,
  stage: "",
  startedAt: "",
  updatedAt: "",
  result: null,
  error: ""
};

browser.runtime.onMessage.addListener((message) => {
  if (!message) {
    return undefined;
  }

  if (message.type === DOWNLOAD_MESSAGE_TYPE) {
    return downloadTextFile(message);
  }

  if (message.type === START_SCAN_MESSAGE_TYPE) {
    return startScan();
  }

  if (message.type === GET_SCAN_STATE_MESSAGE_TYPE) {
    return getScanState();
  }

  if (message.type === FINISH_SCAN_MESSAGE_TYPE) {
    return finishScanNow();
  }

  if (message.type === PROGRESS_MESSAGE_TYPE) {
    updateProgress(message);
    return Promise.resolve({ ok: true });
  }

  return undefined;
});

async function startScan() {
  if (scanState.status === "running") {
    return getScanState();
  }

  const tab = await getActiveTab();

  if (!isChatGptTab(tab)) {
    throw new Error("Открой вкладку chatgpt.com с нужным диалогом.");
  }

  const jobId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  Object.assign(scanState, {
    status: "running",
    jobId,
    tabId: tab.id,
    count: 0,
    stage: "start",
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    result: null,
    error: ""
  });
  broadcastState();

  runScan(tab.id, jobId);

  return getScanState();
}

async function runScan(tabId, jobId) {
  try {
    const exportData = await requestExtraction(tabId, jobId);

    if (scanState.jobId !== jobId) {
      return;
    }

    if (!exportData?.ok) {
      throw new Error("Не получилось найти сообщения на странице.");
    }

    await browser.storage.local.set({ latestExport: exportData });
    Object.assign(scanState, {
      status: "done",
      count: exportData.messages.length,
      stage: "done",
      updatedAt: new Date().toISOString(),
      result: exportData,
      error: ""
    });
  } catch (error) {
    if (scanState.jobId !== jobId) {
      return;
    }

    Object.assign(scanState, {
      status: "error",
      stage: "error",
      updatedAt: new Date().toISOString(),
      error: error?.message || "Не удалось собрать чат."
    });
  }

  broadcastState();
}

async function finishScanNow() {
  if (scanState.status !== "running" || !scanState.tabId) {
    return getScanState();
  }

  try {
    await browser.tabs.sendMessage(scanState.tabId, {
      type: "chatgpt-saver:control",
      jobId: scanState.jobId,
      action: "finish"
    });
    scanState.stage = "finishing";
    scanState.updatedAt = new Date().toISOString();
    broadcastState();
  } catch (error) {
    scanState.error = error?.message || "";
  }

  return getScanState();
}

async function getScanState() {
  if (scanState.status === "idle" && !scanState.result) {
    const stored = await browser.storage.local.get("latestExport");

    if (stored.latestExport?.messages?.length) {
      scanState.result = stored.latestExport;
      scanState.count = stored.latestExport.messages.length;
      scanState.status = "done";
      scanState.stage = "stored";
      scanState.updatedAt = new Date().toISOString();
    }
  }

  return serializeScanState();
}

function serializeScanState() {
  return {
    status: scanState.status,
    jobId: scanState.jobId,
    count: scanState.count,
    stage: scanState.stage,
    startedAt: scanState.startedAt,
    updatedAt: scanState.updatedAt,
    result: scanState.result,
    error: scanState.error
  };
}

function updateProgress(message) {
  if (scanState.status !== "running" || message.jobId !== scanState.jobId) {
    return;
  }

  scanState.count = message.count || 0;
  scanState.stage = message.stage || "";
  scanState.updatedAt = new Date().toISOString();
  broadcastState();
}

function broadcastState() {
  browser.runtime.sendMessage({
    type: STATUS_MESSAGE_TYPE,
    state: serializeScanState()
  }).catch(() => {});
}

async function requestExtraction(tabId, jobId) {
  const payload = {
    type: "chatgpt-saver:extract-v2",
    jobId,
    scroll: true
  };

  try {
    return await browser.tabs.sendMessage(tabId, payload);
  } catch (firstError) {
    await browser.tabs.executeScript(tabId, {
      file: "contentScript.js",
      runAt: "document_idle"
    });

    return browser.tabs.sendMessage(tabId, payload);
  }
}

async function getActiveTab() {
  const tabs = await browser.tabs.query({
    active: true,
    currentWindow: true
  });

  return tabs[0];
}

function isChatGptTab(tab) {
  return Boolean(tab?.url && /^https:\/\/(chatgpt\.com|chat\.openai\.com)\//i.test(tab.url));
}

async function downloadTextFile({ text, filename, mimeType }) {
  if (typeof text !== "string" || !filename) {
    throw new Error("Missing download data.");
  }

  const safeFilename = sanitizeDownloadFilename(filename);
  const safeMimeType = mimeType || "text/plain;charset=utf-8";
  const blob = new Blob([text], { type: safeMimeType });
  const blobUrl = URL.createObjectURL(blob);

  try {
    const downloadId = await startDownload(blobUrl, safeFilename);
    revokeWhenDownloadSettles(blobUrl, downloadId);

    return {
      ok: true,
      downloadId
    };
  } catch (blobError) {
    URL.revokeObjectURL(blobUrl);

    try {
      const dataUrl = makeDataUrl(text, safeMimeType);
      const downloadId = await startDownload(dataUrl, safeFilename);

      return {
        ok: true,
        downloadId
      };
    } catch (dataError) {
      const reason = dataError?.message || blobError?.message || "unknown browser error";
      throw new Error(`Download failed: ${reason}`);
    }
  }
}

function startDownload(url, filename) {
  return browser.downloads.download({
    url,
    filename,
    saveAs: true,
    conflictAction: "uniquify"
  });
}

function revokeWhenDownloadSettles(url, downloadId) {
  const timeout = window.setTimeout(cleanup, 10 * 60 * 1000);

  function listener(delta) {
    if (delta.id !== downloadId) {
      return;
    }

    if (delta.state?.current || delta.error?.current) {
      cleanup();
    }
  }

  function cleanup() {
    window.clearTimeout(timeout);
    browser.downloads.onChanged.removeListener(listener);
    URL.revokeObjectURL(url);
  }

  browser.downloads.onChanged.addListener(listener);
}

function makeDataUrl(text, mimeType) {
  return `data:${mimeType},${encodeURIComponent(text)}`;
}

function sanitizeDownloadFilename(filename) {
  return filename
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, " ")
    .replace(/^\.+/g, "")
    .trim()
    .slice(0, 180) || "chatgpt-chat.txt";
}
