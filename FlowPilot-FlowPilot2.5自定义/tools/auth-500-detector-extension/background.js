const AUTH_500_DETECTOR_TARGET_HOST = 'auth.openai.com';
const AUTH_500_DETECTOR_TARGET_PATH = '/contact-verification';
const AUTH_500_DETECTOR_RECORD_TTL_MS = 5 * 60 * 1000;
const auth500DetectorRecords = new Map();

/**
 * 判断 URL 是否是 OpenAI 手机验证页面。
 */
function isAuth500DetectorTargetUrl(url = '') {
  try {
    const parsed = new URL(url);
    return parsed.hostname === AUTH_500_DETECTOR_TARGET_HOST
      && parsed.pathname === AUTH_500_DETECTOR_TARGET_PATH;
  } catch (_error) {
    return false;
  }
}

/**
 * 清理过期的网络状态记录。
 */
function pruneAuth500DetectorRecords() {
  const now = Date.now();
  for (const [tabId, record] of auth500DetectorRecords.entries()) {
    if (now - Number(record?.capturedAt || 0) > AUTH_500_DETECTOR_RECORD_TTL_MS) {
      auth500DetectorRecords.delete(tabId);
    }
  }
}

/**
 * 保存主框架请求的 HTTP 状态码。
 */
function rememberAuth500DetectorStatus(details) {
  if (details.type !== 'main_frame' || !isAuth500DetectorTargetUrl(details.url)) {
    return;
  }
  auth500DetectorRecords.set(details.tabId, {
    url: details.url,
    statusCode: Number(details.statusCode) || 0,
    error: '',
    capturedAt: Date.now(),
  });
  pruneAuth500DetectorRecords();
}

/**
 * 保存主框架请求失败信息。
 */
function rememberAuth500DetectorError(details) {
  if (details.type !== 'main_frame' || !isAuth500DetectorTargetUrl(details.url)) {
    return;
  }
  auth500DetectorRecords.set(details.tabId, {
    url: details.url,
    statusCode: 0,
    error: String(details.error || ''),
    capturedAt: Date.now(),
  });
  pruneAuth500DetectorRecords();
}

/**
 * 读取指定标签页最近一次网络状态记录。
 */
function getAuth500DetectorRecord(tabId) {
  pruneAuth500DetectorRecords();
  return auth500DetectorRecords.get(tabId) || null;
}

chrome.webRequest.onCompleted.addListener(
  rememberAuth500DetectorStatus,
  { urls: ['https://auth.openai.com/contact-verification*'], types: ['main_frame'] }
);

chrome.webRequest.onErrorOccurred.addListener(
  rememberAuth500DetectorError,
  { urls: ['https://auth.openai.com/contact-verification*'], types: ['main_frame'] }
);

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== 'AUTH_500_DETECTOR_GET_RECORD') {
    return false;
  }
  sendResponse({ record: getAuth500DetectorRecord(Number(message.tabId)) });
  return false;
});
