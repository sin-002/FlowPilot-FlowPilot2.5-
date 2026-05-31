const scanButton = document.getElementById('scan-button');
const reloadButton = document.getElementById('reload-button');
const pageUrlNode = document.getElementById('page-url');
const resultCard = document.getElementById('result-card');
const resultTitle = document.getElementById('result-title');
const resultDetail = document.getElementById('result-detail');
const pageInfo = document.getElementById('page-info');
const statusNode = document.getElementById('status');

const AUTH_HOST = 'auth.openai.com';
const CONTACT_VERIFICATION_PATH = '/contact-verification';
const HTTP_500_PATTERN = /http\s*error\s*500|500|无法正常运作|无法处理此请求|isn['’]?t\s+working|unable\s+to\s+handle\s+this\s+request/i;
const PREVIEW_LIMIT = 1200;

/**
 * 压缩页面文本，方便稳定匹配 Chrome 错误页内容。
 */
function normalizeText(value = '') {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

/**
 * 判断 URL 是否是 OpenAI 手机验证页面。
 */
function isContactVerificationUrl(url = '') {
  try {
    const parsed = new URL(url);
    return parsed.hostname === AUTH_HOST && parsed.pathname === CONTACT_VERIFICATION_PATH;
  } catch (_error) {
    return false;
  }
}

/**
 * 判断当前页面文本是否呈现 HTTP 500 错误。
 */
function isHttp500Page(page = {}) {
  const text = normalizeText([
    page.title,
    page.bodyText,
    page.documentText,
  ].join(' '));
  return HTTP_500_PATTERN.test(text);
}

/**
 * 汇总当前页面诊断结果。
 */
function buildDetectionResult(page = {}, networkRecord = null) {
  const contactVerification = isContactVerificationUrl(page.url);
  const networkStatusCode = Number(networkRecord?.statusCode || 0);
  const network500 = networkStatusCode === 500;
  const http500 = isHttp500Page(page);
  return {
    contactVerification,
    http500: http500 || network500,
    networkStatusCode,
    networkError: String(networkRecord?.error || ''),
    matched: contactVerification && (http500 || network500),
    textPreview: normalizeText(page.bodyText || page.documentText).slice(0, PREVIEW_LIMIT),
  };
}

/**
 * 读取当前活动标签页的 URL、标题和页面文本。
 */
async function readActiveTabPage() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) {
    throw new Error('没有找到当前活动标签页。');
  }

  let result = null;
  let injectionError = '';
  try {
    [result] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => ({
        url: location.href,
        title: document.title,
        bodyText: document.body?.innerText || '',
        documentText: document.documentElement?.innerText || '',
      }),
    });
  } catch (error) {
    injectionError = error?.message || String(error || '');
  }

  return {
    tabId: tab.id,
    url: tab.url || result?.result?.url || '',
    title: result?.result?.title || tab.title || '',
    bodyText: result?.result?.bodyText || '',
    documentText: result?.result?.documentText || '',
    injectionError,
  };
}

/**
 * 读取后台 webRequest 捕获到的当前标签页网络状态。
 */
async function readNetworkRecord(tabId) {
  if (!tabId) {
    return null;
  }
  const response = await chrome.runtime.sendMessage({
    type: 'AUTH_500_DETECTOR_GET_RECORD',
    tabId,
  });
  return response?.record || null;
}

/**
 * 设置底部状态文本。
 */
function setStatus(message, isError = false) {
  statusNode.textContent = message;
  statusNode.classList.toggle('is-error', Boolean(isError));
}

/**
 * 渲染检测结果。
 */
function renderResult(page, detection) {
  pageUrlNode.textContent = page.url || '当前页面 URL 为空';
  resultCard.classList.toggle('is-ok', detection.matched);
  resultCard.classList.toggle('is-error', !detection.matched);

  if (detection.matched) {
    resultTitle.textContent = '命中 500';
    resultDetail.textContent = detection.networkStatusCode === 500
      ? 'webRequest 捕获到当前主框架 HTTP 状态码 500。'
      : '当前页是 auth.openai.com/contact-verification，并检测到 HTTP ERROR 500。';
  } else if (!detection.contactVerification) {
    resultTitle.textContent = '不是目标页';
    resultDetail.textContent = '当前页不是 auth.openai.com/contact-verification。';
  } else {
    resultTitle.textContent = '未检测到 500';
    resultDetail.textContent = '当前页是 contact-verification，但没有匹配到 500 错误文案。';
  }

  pageInfo.textContent = JSON.stringify({
    url: page.url,
    title: page.title,
    injectionError: page.injectionError,
    contactVerification: detection.contactVerification,
    http500: detection.http500,
    networkStatusCode: detection.networkStatusCode,
    networkError: detection.networkError,
    matched: detection.matched,
    preview: detection.textPreview,
  }, null, 2);
}

/**
 * 扫描当前活动标签页并刷新 popup。
 */
async function scanCurrentPage() {
  scanButton.disabled = true;
  reloadButton.disabled = true;
  setStatus('正在检测当前页面...');
  try {
    const page = await readActiveTabPage();
    const networkRecord = await readNetworkRecord(page.tabId);
    if (/showing error page/i.test(page.injectionError) && isContactVerificationUrl(page.url)) {
      renderResult(page, {
        contactVerification: true,
        http500: true,
        networkStatusCode: Number(networkRecord?.statusCode || 0),
        networkError: String(networkRecord?.error || ''),
        matched: true,
        textPreview: page.injectionError,
      });
      setStatus(Number(networkRecord?.statusCode || 0) === 500
        ? '检测完成：已捕获真实 HTTP 500。'
        : '检测完成：Chrome 错误页禁止注入，暂未捕获真实状态码；可点“刷新并捕获状态码”。');
      return;
    }
    const detection = buildDetectionResult(page, networkRecord);
    renderResult(page, detection);
    setStatus(detection.matched ? '检测完成：当前页面是 500。' : '检测完成：未命中目标 500。', false);
  } catch (error) {
    resultCard.classList.remove('is-ok');
    resultCard.classList.add('is-error');
    resultTitle.textContent = '读取失败';
    resultDetail.textContent = error?.message || '无法读取当前页面。';
    pageInfo.textContent = '';
    setStatus(error?.message || '读取当前页面失败。', true);
  } finally {
    scanButton.disabled = false;
    reloadButton.disabled = false;
  }
}

/**
 * 刷新当前页，让后台 webRequest 捕获真实 HTTP 状态码。
 */
async function reloadAndCaptureCurrentPage() {
  reloadButton.disabled = true;
  scanButton.disabled = true;
  setStatus('正在刷新当前页并等待 webRequest 状态码...');
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) {
      throw new Error('没有找到当前活动标签页。');
    }
    await chrome.tabs.reload(tab.id, { bypassCache: true });
    await new Promise((resolve) => setTimeout(resolve, 1800));
    await scanCurrentPage();
  } catch (error) {
    setStatus(error?.message || '刷新并捕获状态码失败。', true);
  } finally {
    reloadButton.disabled = false;
    scanButton.disabled = false;
  }
}

scanButton.addEventListener('click', () => {
  scanCurrentPage();
});

reloadButton.addEventListener('click', () => {
  reloadAndCaptureCurrentPage();
});

scanCurrentPage();
