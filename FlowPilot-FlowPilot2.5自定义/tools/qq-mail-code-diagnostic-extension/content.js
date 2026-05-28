(function attachQqMailCodeDiagnostic() {
  const QQ_DIAG_SCAN_TAB = 'QQ_DIAG_SCAN_TAB';
  const QQ_DIAG_SCAN_FRAME = 'QQ_DIAG_SCAN_FRAME';
  const QQ_DIAG_SHOW_PANEL = 'QQ_DIAG_SHOW_PANEL';
  const PANEL_ID = 'qq-mail-code-diagnostic-panel';
  const FRAME_LABEL = window === window.top ? 'top' : 'child';

  function normalizeText(value = '') {
    return String(value || '').replace(/\s+/g, ' ').trim();
  }

  function extractVerificationCode(text = '') {
    const sourceText = normalizeText(text);
    const patterns = [
      /(?:chatgpt\s+log-?in\s+code|enter\s+this\s+code)[^0-9]{0,24}(\d{6})/i,
      /your\s+chatgpt\s+code\s+is\s+(\d{6})/i,
      /(?:verification\s+code|temporary\s+verification\s+code|your\s+chatgpt\s+code|code(?:\s+is)?)[^0-9]{0,16}(\d{6})/i,
      /(?:代码为|验证码[^0-9]*?)[\s：:]*(\d{6})/,
      /code[:\s]+is[:\s]+(\d{6})|code[:\s]+(\d{6})/i,
      /\b(\d{6})\b/,
    ];
    for (const pattern of patterns) {
      const match = sourceText.match(pattern);
      if (match) {
        return match[1] || match[2] || '';
      }
    }
    return '';
  }

  function includesAny(text = '', keywords = []) {
    const normalizedText = normalizeText(text).toLowerCase();
    return keywords.some((keyword) => normalizedText.includes(String(keyword || '').toLowerCase()));
  }

  function getReason(sender = '', subject = '', digest = '', body = '') {
    const senderMatched = includesAny(sender, ['openai', 'noreply', 'verify', 'auth', 'chatgpt', 'duckduckgo', 'forward']);
    const subjectMatched = includesAny(subject, ['verify', 'verification', 'code', '验证码', 'confirm', 'login']);
    const bodyMatched = includesAny(body || digest, ['openai', 'chatgpt', 'verification', '验证码', '代码', 'login code']);
    return { senderMatched, subjectMatched, bodyMatched };
  }

  function summarizeMailItem(item, index) {
    const sender = normalizeText(item.querySelector('.cmp-account-nick')?.textContent);
    const subject = normalizeText(item.querySelector('.mail-subject')?.textContent);
    const digest = normalizeText(item.querySelector('.mail-digest')?.textContent);
    const itemText = normalizeText(item.textContent);
    const combinedText = `${sender} ${subject} ${digest} ${itemText}`;
    const code = extractVerificationCode(combinedText);
    const reason = getReason(sender, subject, digest, itemText);
    return {
      index,
      mailId: item.getAttribute('data-mailid') || '',
      sender,
      subject,
      digest,
      code,
      matched: Boolean(code) && (reason.senderMatched || reason.subjectMatched || reason.bodyMatched),
      reason,
      textPreview: combinedText.slice(0, 240),
    };
  }

  function scanMailListItems() {
    return Array.from(document.querySelectorAll('.mail-list-page-item[data-mailid]'))
      .map((item, index) => summarizeMailItem(item, index))
      .slice(0, 30);
  }

  function scanPageText() {
    const bodyText = normalizeText(document.body?.innerText || document.body?.textContent || '');
    const code = extractVerificationCode(bodyText);
    return {
      code,
      textLength: bodyText.length,
      textPreview: bodyText.slice(0, 500),
    };
  }

  function scanCurrentFrame() {
    const listItems = scanMailListItems();
    const pageText = scanPageText();
    const matchedItems = listItems.filter((item) => item.matched || item.code);
    return {
      ok: true,
      frameLabel: FRAME_LABEL,
      frameUrl: location.href,
      title: document.title,
      mailItemCount: listItems.length,
      pageTextCode: pageText.code,
      pageTextLength: pageText.textLength,
      matchedItems,
      listItems,
      pageTextPreview: pageText.textPreview,
    };
  }

  function createElement(tagName, className = '', text = '') {
    const element = document.createElement(tagName);
    if (className) {
      element.className = className;
    }
    if (text) {
      element.textContent = text;
    }
    return element;
  }

  function formatReason(reason = {}) {
    const parts = [];
    if (reason.senderMatched) parts.push('发件人命中');
    if (reason.subjectMatched) parts.push('主题命中');
    if (reason.bodyMatched) parts.push('正文命中');
    return parts.join(' / ') || '仅发现 6 位数字';
  }

  function renderResults(container, response) {
    container.textContent = '';
    if (!response?.ok) {
      container.appendChild(createElement('div', 'qq-diag-error', response?.error || '扫描失败'));
      return;
    }

    const results = Array.isArray(response.results) ? response.results : [];
    const header = createElement('div', 'qq-diag-summary', `已扫描 ${response.scannedFrameCount || results.length} 个 QQ 邮箱 frame`);
    container.appendChild(header);

    for (const result of results) {
      const section = createElement('div', 'qq-diag-frame');
      section.appendChild(createElement('div', 'qq-diag-frame-title', `${result.frameLabel || 'frame'}：${result.title || result.frameUrl || ''}`));
      if (!result.ok) {
        section.appendChild(createElement('div', 'qq-diag-error', result.error || '该 frame 无法扫描'));
        container.appendChild(section);
        continue;
      }

      section.appendChild(createElement('div', 'qq-diag-meta', `邮件列表项：${result.mailItemCount || 0}，页面全文验证码：${result.pageTextCode || '未发现'}`));
      const matchedItems = Array.isArray(result.matchedItems) ? result.matchedItems : [];
      if (!matchedItems.length) {
        section.appendChild(createElement('div', 'qq-diag-warn', '未在邮件列表中发现命中项。下面展示前几封邮件预览。'));
      }

      const items = matchedItems.length ? matchedItems : (Array.isArray(result.listItems) ? result.listItems.slice(0, 5) : []);
      for (const item of items) {
        const itemNode = createElement('div', item.code ? 'qq-diag-item qq-diag-item-ok' : 'qq-diag-item');
        itemNode.appendChild(createElement('div', 'qq-diag-code', `验证码：${item.code || '未识别'}`));
        itemNode.appendChild(createElement('div', 'qq-diag-line', `发件人：${item.sender || '未知'}`));
        itemNode.appendChild(createElement('div', 'qq-diag-line', `主题：${item.subject || '未知'}`));
        itemNode.appendChild(createElement('div', 'qq-diag-line', `原因：${formatReason(item.reason)}`));
        itemNode.appendChild(createElement('div', 'qq-diag-preview', item.textPreview || '无预览'));
        section.appendChild(itemNode);
      }
      container.appendChild(section);
    }
  }

  function injectPanel() {
    if (window !== window.top || document.getElementById(PANEL_ID)) {
      return;
    }
    const panel = createElement('div', '', '');
    panel.id = PANEL_ID;
    panel.innerHTML = `
      <style>
        #${PANEL_ID} {
          position: fixed;
          right: 16px;
          bottom: 16px;
          z-index: 2147483647;
          width: min(460px, calc(100vw - 32px));
          max-height: min(620px, calc(100vh - 32px));
          overflow: auto;
          padding: 12px;
          border: 1px solid #0f766e;
          border-radius: 8px;
          background: #ffffff;
          color: #111827;
          box-shadow: 0 18px 45px rgba(15, 23, 42, 0.22);
          font: 12px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        }
        #${PANEL_ID} .qq-diag-top {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 8px;
          margin-bottom: 10px;
        }
        #${PANEL_ID} .qq-diag-title {
          font-weight: 700;
          font-size: 14px;
        }
        #${PANEL_ID} button {
          border: 1px solid #0f766e;
          border-radius: 6px;
          background: #0f766e;
          color: #ffffff;
          cursor: pointer;
          font-weight: 600;
          padding: 5px 9px;
        }
        #${PANEL_ID} button.qq-diag-close {
          border-color: #d1d5db;
          background: #ffffff;
          color: #374151;
        }
        #${PANEL_ID} .qq-diag-summary,
        #${PANEL_ID} .qq-diag-meta {
          color: #374151;
          margin: 4px 0;
        }
        #${PANEL_ID} .qq-diag-frame {
          border-top: 1px solid #e5e7eb;
          margin-top: 10px;
          padding-top: 10px;
        }
        #${PANEL_ID} .qq-diag-frame-title {
          font-weight: 700;
          word-break: break-all;
        }
        #${PANEL_ID} .qq-diag-item {
          border: 1px solid #e5e7eb;
          border-radius: 6px;
          margin-top: 8px;
          padding: 8px;
          background: #f9fafb;
        }
        #${PANEL_ID} .qq-diag-item-ok {
          border-color: #22c55e;
          background: #f0fdf4;
        }
        #${PANEL_ID} .qq-diag-code {
          font-weight: 800;
          color: #047857;
        }
        #${PANEL_ID} .qq-diag-line,
        #${PANEL_ID} .qq-diag-preview {
          margin-top: 3px;
          word-break: break-word;
        }
        #${PANEL_ID} .qq-diag-preview {
          color: #6b7280;
        }
        #${PANEL_ID} .qq-diag-error {
          color: #b91c1c;
          font-weight: 700;
        }
        #${PANEL_ID} .qq-diag-warn {
          color: #b45309;
          margin-top: 5px;
        }
      </style>
      <div class="qq-diag-top">
        <div class="qq-diag-title">QQ 邮箱验证码诊断</div>
        <div>
          <button type="button" id="qq-diag-scan">扫描</button>
          <button type="button" id="qq-diag-close" class="qq-diag-close">关闭</button>
        </div>
      </div>
      <div id="qq-diag-results">打开 QQ 邮箱收件箱后点击“扫描”。</div>
    `;
    document.documentElement.appendChild(panel);

    const resultNode = panel.querySelector('#qq-diag-results');
    panel.querySelector('#qq-diag-close')?.addEventListener('click', () => {
      panel.remove();
    });
    panel.querySelector('#qq-diag-scan')?.addEventListener('click', async () => {
      resultNode.textContent = '正在扫描所有 QQ 邮箱 frame...';
      try {
        const response = await chrome.runtime.sendMessage({ type: QQ_DIAG_SCAN_TAB });
        renderResults(resultNode, response);
      } catch (error) {
        renderResults(resultNode, { ok: false, error: error?.message || '扫描失败' });
      }
    });
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === QQ_DIAG_SHOW_PANEL) {
      injectPanel();
      sendResponse({ ok: true });
      return false;
    }
    if (message?.type === QQ_DIAG_SCAN_FRAME) {
      sendResponse(scanCurrentFrame());
      return false;
    }
    return false;
  });

  injectPanel();
})();
