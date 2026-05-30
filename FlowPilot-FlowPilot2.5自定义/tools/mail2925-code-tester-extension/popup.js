const scanButton = document.getElementById('scan-button');
const pageUrlNode = document.getElementById('page-url');
const targetEmailInput = document.getElementById('target-email');
const recipientStatusNode = document.getElementById('recipient-status');
const recipientsNode = document.getElementById('recipients');
const codeNode = document.getElementById('code');
const sourceNode = document.getElementById('source');
const candidatesNode = document.getElementById('candidates');
const previewNode = document.getElementById('preview');
const statusNode = document.getElementById('status');

const TARGET_EMAIL_STORAGE_KEY = 'mail2925CodeTesterTargetEmail';
const PREVIEW_TEXT_LIMIT = 1200;
const CONTEXT_RADIUS = 80;
const FALLBACK_CODE_PATTERN = /\b(\d{6})\b/g;
const EMAIL_PATTERN = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;
const ROUTING_CONTEXT_PATTERN = /(?:bounce|bounces|return-path|代发|发件人)/i;
const ROUTING_SYMBOL_PATTERN = /(?:@|\.openai\.com|\.tm\.openai\.com|em\d+|=|[-+])/;
const ROUTING_TOKEN_PATTERN = /(?:bounce|bounces|return-path|@|\.openai\.com|\.tm\.openai\.com|em\d+|=|[-+])/i;

const CODE_RULES = Object.freeze([
  Object.freeze({
    label: 'OpenAI 中文正文',
    pattern: /输入此临时验证码以继续[\s\S]{0,80}?(\d{6})/,
  }),
  Object.freeze({
    label: 'ChatGPT 登录英文正文',
    pattern: /(?:chatgpt\s+log-?in\s+code|suspicious\s+log-?in)[\s\S]{0,200}?enter\s+this\s+code[\s\S]{0,80}?(\d{6})/i,
  }),
  Object.freeze({
    label: 'Enter this code',
    pattern: /enter\s+this\s+code[\s\S]{0,80}?(\d{6})/i,
  }),
  Object.freeze({
    label: 'Your ChatGPT code',
    pattern: /your\s+(?:temporary\s+)?chatgpt\s+(?:(?:log-?in|login)\s+)?code\s+is[\s\S]{0,80}?(\d{6})/i,
  }),
  Object.freeze({
    label: '中文验证码',
    pattern: /(?:代码为|验证码[^0-9]*?)[\s：:]*(\d{6})/,
  }),
  Object.freeze({
    label: '英文 code is',
    pattern: /code[:\s]+is[:\s]+(\d{6})|code[:\s]+(\d{6})/i,
  }),
]);

/**
 * 压缩页面文本空白，避免 2925 DOM 换行影响正则匹配。
 */
function normalizeText(value = '') {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

/**
 * 归一化邮箱用于一致性对比。
 */
function normalizeEmail(value = '') {
  return String(value || '').trim().toLowerCase();
}

/**
 * 从文本片段中提取邮箱地址并去重。
 */
function extractEmails(text = '') {
  const matches = String(text || '').match(EMAIL_PATTERN) || [];
  return [...new Set(matches.map((email) => normalizeEmail(email)).filter(Boolean))];
}

/**
 * 从 2925 详情页文本中优先提取“收件人”字段里的邮箱。
 */
function extractRecipientEmails(text = '') {
  const normalized = normalizeText(text);
  const sectionMatch = normalized.match(/收件人\s*[:：]\s*([\s\S]{0,320}?)(?:\s+(?:时\s*间|时间|查看附件|OpenAI|发件人\s*[:：]|主题\s*[:：]))/i);
  if (sectionMatch) {
    const sectionEmails = extractEmails(sectionMatch[1]);
    if (sectionEmails.length) {
      return {
        emails: sectionEmails,
        source: '收件人字段',
        section: sectionMatch[1],
      };
    }
  }

  const recipientIndex = normalized.search(/收件人\s*[:：]/);
  if (recipientIndex >= 0) {
    const fallbackSection = normalized.slice(recipientIndex, recipientIndex + 320);
    const fallbackEmails = extractEmails(fallbackSection);
    if (fallbackEmails.length) {
      return {
        emails: fallbackEmails,
        source: '收件人附近文本',
        section: fallbackSection,
      };
    }
  }

  return {
    emails: [],
    source: '未识别',
    section: '',
  };
}

/**
 * 对比详情页收件人和用户输入的当前流程邮箱。
 */
function checkRecipientMatch(text = '', targetEmail = '') {
  const normalizedTarget = normalizeEmail(targetEmail);
  const recipientResult = extractRecipientEmails(text);
  if (!normalizedTarget) {
    return {
      ...recipientResult,
      targetEmail: '',
      matches: false,
      status: 'empty-target',
      message: '输入当前流程邮箱后重新识别，会检查详情页收件人是否一致。',
    };
  }

  if (!recipientResult.emails.length) {
    return {
      ...recipientResult,
      targetEmail: normalizedTarget,
      matches: false,
      status: 'no-recipient',
      message: `未从详情页识别到收件人，无法确认是否为 ${normalizedTarget}。`,
    };
  }

  const matches = recipientResult.emails.includes(normalizedTarget);
  return {
    ...recipientResult,
    targetEmail: normalizedTarget,
    matches,
    status: matches ? 'match' : 'mismatch',
    message: matches
      ? `一致：详情页收件人包含 ${normalizedTarget}。`
      : `不一致：详情页收件人不是 ${normalizedTarget}。`,
  };
}

/**
 * 判断 6 位数字是否像邮件头里的紧凑时间值。
 */
function isLikelyCompactTimeValue(value = '') {
  const text = String(value || '');
  if (!/^\d{6}$/.test(text)) return false;

  const hours = Number(text.slice(0, 2));
  const minutes = Number(text.slice(2, 4));
  const seconds = Number(text.slice(4, 6));
  return hours >= 0 && hours <= 23
    && minutes >= 0 && minutes <= 59
    && seconds >= 0 && seconds <= 59;
}

/**
 * 跳过邮件头日期时间，避免把 174414 这类时间误当验证码。
 */
function isLikelyHeaderTimestampCode(text, index, value) {
  const source = String(text || '');
  const candidate = String(value || '');
  if (!candidate) return false;

  const before = source.slice(Math.max(0, index - CONTEXT_RADIUS), index);
  const after = source.slice(index + candidate.length, index + candidate.length + 40);
  const context = `${before}${candidate}${after}`.replace(/\s+/g, ' ');
  const beforeCompact = before.replace(/\s+/g, ' ');
  const timeLike = isLikelyCompactTimeValue(candidate);

  if (
    timeLike
    && /(?:\d{4}[-/.]\d{1,2}[-/.]\d{1,2}|\d{1,2}[-/.]\d{1,2})\s*$/.test(beforeCompact)
  ) {
    return true;
  }

  if (
    timeLike
    && /(?:\d{4}[-/.]\d{1,2}[-/.]\d{1,2}|\d{1,2}[-/.]\d{1,2})\s*(?:\d{1,2}:\d{2}(?::\d{2})?|\d{6})/.test(context)
  ) {
    return true;
  }

  return /(?:time|date|sent|received|received\s+at|sent\s+at|时\s*间|日\s*期)[\s:：-]*$/i.test(beforeCompact)
    && (timeLike || /^20\d{4}$/.test(candidate));
}

/**
 * 跳过 bounces 代发地址里的数字，避免把路由 ID 识别成验证码。
 */
function isLikelyMailRoutingCode(text, index, value) {
  const source = String(text || '');
  const candidate = String(value || '');
  if (!candidate) return false;

  const tokenStart = source.slice(0, index).search(/[^\s<>"'()（）【】,，;；]*$/);
  const leftToken = source.slice(0, index).slice(tokenStart < 0 ? 0 : tokenStart);
  const rightTokenMatch = source.slice(index + candidate.length).match(/^[^\s<>"'()（）【】,，;；]*/);
  const token = `${leftToken}${candidate}${rightTokenMatch?.[0] || ''}`;
  if (ROUTING_TOKEN_PATTERN.test(token)) {
    return true;
  }

  const before = source.slice(Math.max(0, index - CONTEXT_RADIUS), index);
  const after = source.slice(index + candidate.length, index + candidate.length + CONTEXT_RADIUS);
  const context = `${before}${candidate}${after}`.replace(/\s+/g, ' ');

  return ROUTING_CONTEXT_PATTERN.test(context)
    && ROUTING_SYMBOL_PATTERN.test(context)
    && /(?:bounce|bounces|return-path|@)/i.test(token);
}

/**
 * 收集页面里的 6 位数字，并标注是否被跳过。
 */
function collectStandaloneCandidates(text = '') {
  const normalized = String(text || '');
  const candidates = [];
  let match = null;

  while ((match = FALLBACK_CODE_PATTERN.exec(normalized)) !== null) {
    const value = match[1];
    const skippedByTime = isLikelyHeaderTimestampCode(normalized, match.index, value);
    const skippedByRouting = isLikelyMailRoutingCode(normalized, match.index, value);
    candidates.push({
      value,
      skipped: skippedByTime || skippedByRouting,
      reason: skippedByRouting ? '邮件路由数字' : (skippedByTime ? '邮件头时间' : '可用候选'),
    });
  }

  return candidates;
}

/**
 * 用 2925 主扩展同源规则识别当前页面验证码。
 */
function extractVerificationCode(text = '') {
  const normalized = normalizeText(text);
  for (const rule of CODE_RULES) {
    const match = normalized.match(rule.pattern);
    if (match) {
      return {
        code: match[1] || match[2] || '',
        source: rule.label,
        candidates: collectStandaloneCandidates(normalized),
      };
    }
  }

  const candidates = collectStandaloneCandidates(normalized);
  const picked = candidates.find((candidate) => !candidate.skipped);
  return {
    code: picked?.value || '',
    source: picked ? '兜底 6 位数字' : '未识别',
    candidates,
  };
}

/**
 * 从当前活动标签页读取详情页文本。
 */
async function readActiveTabText() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) {
    throw new Error('没有找到当前活动标签页。');
  }

  const [result] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: () => ({
      title: document.title,
      url: location.href,
      text: document.body?.innerText || document.body?.textContent || '',
    }),
  });

  return result?.result || { title: '', url: tab.url || '', text: '' };
}

/**
 * 渲染候选数字列表。
 */
function renderCandidates(candidates = [], pickedCode = '') {
  candidatesNode.textContent = '';
  if (!candidates.length) {
    candidatesNode.textContent = '未发现 6 位数字';
    return;
  }

  candidates.slice(0, 30).forEach((candidate) => {
    const item = document.createElement('span');
    item.className = 'candidate';
    if (candidate.value === pickedCode) {
      item.classList.add('is-picked');
    } else if (candidate.skipped) {
      item.classList.add('is-skipped');
    }
    item.textContent = `${candidate.value}：${candidate.reason}`;
    candidatesNode.appendChild(item);
  });
}

/**
 * 渲染详情页收件人检查结果。
 */
function renderRecipientCheck(result) {
  recipientStatusNode.textContent = result.message;
  recipientStatusNode.classList.toggle('is-match', result.status === 'match');
  recipientStatusNode.classList.toggle('is-mismatch', result.status === 'mismatch');
  recipientStatusNode.classList.toggle('is-warn', result.status === 'no-recipient');

  recipientsNode.textContent = '';
  if (!result.emails.length) {
    recipientsNode.textContent = '未识别到收件人邮箱';
    return;
  }

  result.emails.forEach((email) => {
    const item = document.createElement('span');
    item.className = 'recipient';
    if (email === result.targetEmail) {
      item.classList.add('is-match');
    }
    item.textContent = `${email}（${result.source}）`;
    recipientsNode.appendChild(item);
  });
}

/**
 * 设置底部状态文本。
 */
function setStatus(message, isError = false) {
  statusNode.textContent = message;
  statusNode.classList.toggle('is-error', Boolean(isError));
}

/**
 * 扫描当前页面并更新 popup。
 */
async function scanCurrentPage() {
  scanButton.disabled = true;
  const targetEmail = normalizeEmail(targetEmailInput.value);
  localStorage.setItem(TARGET_EMAIL_STORAGE_KEY, targetEmail);
  setStatus('正在读取当前页面...');
  try {
    const page = await readActiveTabText();
    const normalizedText = normalizeText(page.text);
    const result = extractVerificationCode(normalizedText);
    const recipientCheck = checkRecipientMatch(normalizedText, targetEmail);

    pageUrlNode.textContent = page.url || page.title || '当前页面';
    codeNode.textContent = result.code || '--';
    sourceNode.textContent = result.code
      ? `命中规则：${result.source}`
      : '未识别到验证码';
    previewNode.textContent = normalizedText.slice(0, PREVIEW_TEXT_LIMIT) || '页面文本为空';
    renderRecipientCheck(recipientCheck);
    renderCandidates(result.candidates, result.code);
    setStatus(result.code ? '识别完成。' : '识别完成，但没有找到验证码。', !result.code);
  } catch (error) {
    codeNode.textContent = '--';
    sourceNode.textContent = '读取失败';
    recipientsNode.textContent = '暂无';
    recipientStatusNode.textContent = '读取失败，无法检查收件人。';
    recipientStatusNode.classList.remove('is-match', 'is-mismatch', 'is-warn');
    candidatesNode.textContent = '暂无';
    previewNode.textContent = '';
    setStatus(error?.message || '读取当前页面失败。', true);
  } finally {
    scanButton.disabled = false;
  }
}

scanButton.addEventListener('click', () => {
  scanCurrentPage();
});

targetEmailInput.value = localStorage.getItem(TARGET_EMAIL_STORAGE_KEY) || '';
targetEmailInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    scanCurrentPage();
  }
});

scanCurrentPage();
