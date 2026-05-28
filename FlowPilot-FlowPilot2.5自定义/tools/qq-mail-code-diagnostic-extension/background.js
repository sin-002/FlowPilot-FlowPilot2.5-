const QQ_DIAG_SCAN_TAB = 'QQ_DIAG_SCAN_TAB';
const QQ_DIAG_SCAN_FRAME = 'QQ_DIAG_SCAN_FRAME';
const QQ_DIAG_SHOW_PANEL = 'QQ_DIAG_SHOW_PANEL';

function isQqMailUrl(url = '') {
  return /^https:\/\/(mail|wx)\.mail\.qq\.com\//.test(String(url || ''));
}

function normalizeFrameList(frames) {
  return Array.isArray(frames) ? frames : [];
}

async function scanFrame(tabId, frameId) {
  try {
    return await chrome.tabs.sendMessage(tabId, { type: QQ_DIAG_SCAN_FRAME }, { frameId });
  } catch (error) {
    return {
      ok: false,
      frameId,
      error: error?.message || 'frame 扫描失败',
    };
  }
}

async function scanTab(tabId) {
  const frames = await chrome.webNavigation.getAllFrames({ tabId });
  const scanTargets = normalizeFrameList(frames)
    .filter((frame) => /^https:\/\/(mail|wx)\.mail\.qq\.com\//.test(String(frame.url || '')))
    .map((frame) => Number(frame.frameId));
  const uniqueFrameIds = [...new Set(scanTargets)];
  const results = await Promise.all(uniqueFrameIds.map((frameId) => scanFrame(tabId, frameId)));
  return {
    ok: true,
    scannedFrameCount: uniqueFrameIds.length,
    results,
  };
}

async function showPanelInTab(tab) {
  const tabId = tab?.id;
  if (!Number.isInteger(tabId) || !isQqMailUrl(tab?.url)) {
    return;
  }

  try {
    await chrome.tabs.sendMessage(tabId, { type: QQ_DIAG_SHOW_PANEL });
    return;
  } catch (_) {
    await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      files: ['content.js'],
    });
    await chrome.tabs.sendMessage(tabId, { type: QQ_DIAG_SHOW_PANEL });
  }
}

chrome.action.onClicked.addListener((tab) => {
  showPanelInTab(tab).catch(() => {});
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== QQ_DIAG_SCAN_TAB) {
    return false;
  }

  const tabId = sender?.tab?.id;
  if (!Number.isInteger(tabId)) {
    sendResponse({ ok: false, error: '无法定位当前 QQ 邮箱标签页。' });
    return false;
  }

  scanTab(tabId).then(sendResponse).catch((error) => {
    sendResponse({
      ok: false,
      error: error?.message || '扫描 QQ 邮箱标签页失败。',
    });
  });
  return true;
});
