const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const source = fs.readFileSync('content/qq-mail.js', 'utf8');

function extractFunction(name) {
  const markers = [`async function ${name}(`, `function ${name}(`];
  const start = markers
    .map((marker) => source.indexOf(marker))
    .find((index) => index >= 0);
  if (start < 0) {
    throw new Error(`missing function ${name}`);
  }

  let parenDepth = 0;
  let signatureEnded = false;
  let braceStart = -1;
  for (let i = start; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === '(') {
      parenDepth += 1;
    } else if (ch === ')') {
      parenDepth -= 1;
      if (parenDepth === 0) {
        signatureEnded = true;
      }
    } else if (ch === '{' && signatureEnded) {
      braceStart = i;
      break;
    }
  }
  if (braceStart < 0) {
    throw new Error(`missing body for function ${name}`);
  }

  let depth = 0;
  let end = braceStart;
  for (; end < source.length; end += 1) {
    const ch = source[end];
    if (ch === '{') depth += 1;
    if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        end += 1;
        break;
      }
    }
  }

  return source.slice(start, end);
}

test('qq extractVerificationCode supports runtime mail rule patterns', () => {
  const bundle = [
    extractFunction('normalizeRulePatternList'),
    extractFunction('extractCodeByRulePatterns'),
    extractFunction('extractVerificationCode'),
  ].join('\n');

  const api = new Function(`
${bundle}
return { extractVerificationCode };
`)();

  assert.equal(
    api.extractVerificationCode('Mailbox notice: use pin A-441122 to continue.', {
      codePatterns: [{ source: 'pin\\s+A-(\\d{6})', flags: 'i' }],
    }),
    '441122'
  );
});

test('qq handlePollEmail forwards runtime code patterns to new-mail matching', async () => {
  const bundle = [
    extractFunction('getCurrentMailIds'),
    extractFunction('normalizeRulePatternList'),
    extractFunction('extractCodeByRulePatterns'),
    extractFunction('normalizeMailText'),
    extractFunction('buildMailCodeSearchText'),
    extractFunction('isFreshQqMailListText'),
    extractFunction('extractVerificationCode'),
    extractFunction('handlePollEmail'),
  ].join('\n');

  const api = new Function(`
let currentItems = [];
let refreshCount = 0;

function createMailItem(mailId, sender, subject, digest) {
  return {
    getAttribute(name) {
      if (name === 'data-mailid') return mailId;
      return '';
    },
    querySelector(selector) {
      if (selector === '.cmp-account-nick') return { textContent: sender };
      if (selector === '.mail-subject') return { textContent: subject };
      if (selector === '.mail-digest') return { textContent: digest };
      return null;
    },
  };
}

const document = {
  querySelectorAll(selector) {
    if (selector === '.mail-list-page-item[data-mailid]') {
      return currentItems;
    }
    return [];
  },
};

async function waitForElement() {
  return true;
}
async function refreshInbox() {
  refreshCount += 1;
  if (refreshCount >= 1) {
    currentItems = [
      createMailItem('mail-1', 'alerts@example.com', 'Security center', 'Use pin A-551188 to continue'),
    ];
  }
}
async function sleep() {}
function log() {}

${bundle}

return { handlePollEmail };
`)();

  const result = await api.handlePollEmail(4, {
    senderFilters: ['alerts'],
    subjectFilters: ['security'],
    maxAttempts: 2,
    intervalMs: 1,
    codePatterns: [{ source: 'pin\\s+A-(\\d{6})', flags: 'i' }],
  });

  assert.equal(result.code, '551188');
});

test('qq handlePollEmail extracts code from full mail item text when digest is empty', async () => {
  const bundle = [
    extractFunction('getCurrentMailIds'),
    extractFunction('normalizeRulePatternList'),
    extractFunction('extractCodeByRulePatterns'),
    extractFunction('normalizeMailText'),
    extractFunction('buildMailCodeSearchText'),
    extractFunction('isFreshQqMailListText'),
    extractFunction('extractVerificationCode'),
    extractFunction('handlePollEmail'),
  ].join('\n');

  const api = new Function(`
let currentItems = [];
let refreshCount = 0;

function createMailItem(mailId, sender, subject, digest, fullText) {
  return {
    textContent: fullText,
    getAttribute(name) {
      if (name === 'data-mailid') return mailId;
      return '';
    },
    querySelector(selector) {
      if (selector === '.cmp-account-nick') return { textContent: sender };
      if (selector === '.mail-subject') return { textContent: subject };
      if (selector === '.mail-digest') return { textContent: digest };
      return null;
    },
  };
}

const document = {
  querySelectorAll(selector) {
    if (selector === '.mail-list-page-item[data-mailid]') {
      return currentItems;
    }
    return [];
  },
};

async function waitForElement() {
  return true;
}
async function refreshInbox() {
  refreshCount += 1;
  if (refreshCount >= 1) {
    currentItems = [
      createMailItem(
        'mail-icloud-forward',
        'OpenAI',
        '你的 OpenAI 临时验证码',
        '',
        'OpenAI 你的 OpenAI 临时验证码 输入此临时验证码以继续： 454766 如果你未尝试将电子邮件地址关联到你的帐户，请忽略此电子邮件。'
      ),
    ];
  }
}
async function sleep() {}
function log(message, level) {
  logs.push({ message, level });
}
const logs = [];

${bundle}

return { handlePollEmail, logs };
`)();

  const result = await api.handlePollEmail(8, {
    senderFilters: ['openai', 'forward'],
    subjectFilters: ['verification', 'code', '验证码'],
    maxAttempts: 2,
    intervalMs: 1,
  });

  assert.equal(result.code, '454766');
  assert.equal(
    api.logs.some((entry) => /正文长度/.test(entry.message) && /摘要长度：0/.test(entry.message)),
    true
  );
});

test('qq handlePollEmail scans current candidate mail during single-attempt polling', async () => {
  const bundle = [
    extractFunction('getCurrentMailIds'),
    extractFunction('normalizeRulePatternList'),
    extractFunction('extractCodeByRulePatterns'),
    extractFunction('normalizeMailText'),
    extractFunction('buildMailCodeSearchText'),
    extractFunction('isFreshQqMailListText'),
    extractFunction('extractVerificationCode'),
    extractFunction('handlePollEmail'),
  ].join('\n');

  const api = new Function(`
const currentItems = [
  {
    textContent: '收件人：wallets_invitee7b@icloud.com 输入此临时验证码以继续： 454766',
    getAttribute(name) {
      if (name === 'data-mailid') return 'existing-target-mail';
      return '';
    },
    querySelector(selector) {
      if (selector === '.cmp-account-nick') return { textContent: 'OpenAI' };
      if (selector === '.mail-subject') return { textContent: '你的 OpenAI 临时验证码' };
      if (selector === '.mail-digest') return { textContent: '' };
      return null;
    },
  },
];

const document = {
  querySelectorAll(selector) {
    if (selector === '.mail-list-page-item[data-mailid]') {
      return currentItems;
    }
    return [];
  },
};

async function waitForElement() {
  return true;
}
async function refreshInbox() {}
async function sleep() {}
function log(message, level) {
  logs.push({ message, level });
}
const logs = [];

${bundle}

return { handlePollEmail, logs };
`)();

  const result = await api.handlePollEmail(8, {
    senderFilters: ['openai', 'forward'],
    subjectFilters: ['verification', 'code', '验证码'],
    maxAttempts: 1,
    intervalMs: 3000,
  });

  assert.equal(result.code, '454766');
  assert.equal(result.mailId, 'existing-target-mail');
});

test('qq handlePollEmail waits before scanning single-attempt polling', async () => {
  const bundle = [
    extractFunction('getCurrentMailIds'),
    extractFunction('normalizeRulePatternList'),
    extractFunction('extractCodeByRulePatterns'),
    extractFunction('normalizeMailText'),
    extractFunction('buildMailCodeSearchText'),
    extractFunction('isFreshQqMailListText'),
    extractFunction('extractVerificationCode'),
    extractFunction('handlePollEmail'),
  ].join('\n');

  const api = new Function(`
let currentItems = [
  {
    textContent: 'OpenAI 你的 OpenAI 临时验证码 输入此临时验证码以继续： 111222 1分钟前',
    getAttribute(name) {
      if (name === 'data-mailid') return 'old-openai-mail';
      return '';
    },
    querySelector(selector) {
      if (selector === '.cmp-account-nick') return { textContent: 'OpenAI' };
      if (selector === '.mail-subject') return { textContent: '你的 OpenAI 临时验证码' };
      if (selector === '.mail-digest') return { textContent: '输入此临时验证码以继续： 111222 1分钟前' };
      return null;
    },
  },
];
let refreshCount = 0;
const sleepCalls = [];

const document = {
  querySelectorAll(selector) {
    if (selector === '.mail-list-page-item[data-mailid]') {
      return currentItems;
    }
    return [];
  },
};

async function waitForElement() {
  return true;
}
async function refreshInbox() {
  refreshCount += 1;
  currentItems = [
    {
      textContent: 'OpenAI 你的 OpenAI 临时验证码 输入此临时验证码以继续： 333444 1分钟前',
      getAttribute(name) {
        if (name === 'data-mailid') return 'fresh-openai-mail';
        return '';
      },
      querySelector(selector) {
        if (selector === '.cmp-account-nick') return { textContent: 'OpenAI' };
        if (selector === '.mail-subject') return { textContent: '你的 OpenAI 临时验证码' };
        if (selector === '.mail-digest') return { textContent: '输入此临时验证码以继续： 333444 1分钟前' };
        return null;
      },
    },
  ];
}
async function sleep(ms) {
  sleepCalls.push(ms);
}
function log() {}

${bundle}

return { handlePollEmail, sleepCalls, getRefreshCount: () => refreshCount };
`)();

  const result = await api.handlePollEmail(8, {
    senderFilters: ['openai', 'forward'],
    subjectFilters: ['verification', 'code', '验证码'],
    maxAttempts: 1,
    intervalMs: 3000,
  });

  assert.equal(result.code, '333444');
  assert.equal(result.mailId, 'fresh-openai-mail');
  assert.equal(api.sleepCalls.includes(20000), true);
  assert.equal(api.getRefreshCount(), 1);
});

test('qq handlePollEmail ignores target recipient hints because QQ list rows do not expose recipients', async () => {
  const bundle = [
    extractFunction('getCurrentMailIds'),
    extractFunction('normalizeRulePatternList'),
    extractFunction('extractCodeByRulePatterns'),
    extractFunction('normalizeMailText'),
    extractFunction('buildMailCodeSearchText'),
    extractFunction('isFreshQqMailListText'),
    extractFunction('extractVerificationCode'),
    extractFunction('handlePollEmail'),
  ].join('\n');

  const api = new Function(`
const currentItems = [
  {
    textContent: 'OpenAI 你的 OpenAI 临时验证码 输入此临时验证码以继续： 454766',
    getAttribute(name) {
      if (name === 'data-mailid') return 'latest-openai-mail';
      return '';
    },
    querySelector(selector) {
      if (selector === '.cmp-account-nick') return { textContent: 'OpenAI' };
      if (selector === '.mail-subject') return { textContent: '你的 OpenAI 临时验证码' };
      if (selector === '.mail-digest') return { textContent: '' };
      return null;
    },
  },
];

const document = {
  querySelectorAll(selector) {
    if (selector === '.mail-list-page-item[data-mailid]') {
      return currentItems;
    }
    return [];
  },
};

async function waitForElement() {
  return true;
}
async function refreshInbox() {}
async function sleep() {}
function log(message, level) {
  logs.push({ message, level });
}
const logs = [];

${bundle}

return { handlePollEmail, logs };
`)();

  const result = await api.handlePollEmail(8, {
    senderFilters: ['openai', 'forward'],
    subjectFilters: ['verification', 'code', '验证码'],
    maxAttempts: 1,
    intervalMs: 3000,
    targetEmail: 'cliches.15-blurb@icloud.com',
    targetEmailHints: ['cliches.15-blurb@icloud.com', 'cliches.15-blurb=icloud.com'],
  });

  assert.equal(result.code, '454766');
  assert.equal(result.mailId, 'latest-openai-mail');
  assert.equal(
    api.logs.some((entry) => /目标邮箱/.test(entry.message)),
    false
  );
});

test('qq handlePollEmail skips stale hour-old candidate mail', async () => {
  const bundle = [
    extractFunction('getCurrentMailIds'),
    extractFunction('normalizeRulePatternList'),
    extractFunction('extractCodeByRulePatterns'),
    extractFunction('normalizeMailText'),
    extractFunction('buildMailCodeSearchText'),
    extractFunction('isFreshQqMailListText'),
    extractFunction('extractVerificationCode'),
    extractFunction('handlePollEmail'),
  ].join('\n');

  const api = new Function(`
const currentItems = [
  {
    textContent: 'OpenAI 你的 OpenAI 临时验证码 输入此临时验证码以继续： 111222 1小时前',
    getAttribute(name) {
      if (name === 'data-mailid') return 'stale-openai-mail';
      return '';
    },
    querySelector(selector) {
      if (selector === '.cmp-account-nick') return { textContent: 'OpenAI' };
      if (selector === '.mail-subject') return { textContent: '你的 OpenAI 临时验证码' };
      if (selector === '.mail-digest') return { textContent: '输入此临时验证码以继续： 111222 1小时前' };
      return null;
    },
  },
];

const document = {
  querySelectorAll(selector) {
    if (selector === '.mail-list-page-item[data-mailid]') {
      return currentItems;
    }
    return [];
  },
};

async function waitForElement() {
  return true;
}
async function refreshInbox() {}
async function sleep() {}
function log(message, level) {
  logs.push({ message, level });
}
const logs = [];

${bundle}

return { handlePollEmail, logs };
`)();

  await assert.rejects(
    () => api.handlePollEmail(8, {
      senderFilters: ['openai', 'forward'],
      subjectFilters: ['verification', 'code', '验证码'],
      maxAttempts: 1,
      intervalMs: 3000,
    }),
    /仍未找到新的匹配邮件/
  );
  assert.equal(
    api.logs.some((entry) => /候选邮件时间过旧/.test(entry.message)),
    true
  );
});

test('qq handlePollEmail accepts minute-level candidate mail', async () => {
  const bundle = [
    extractFunction('getCurrentMailIds'),
    extractFunction('normalizeRulePatternList'),
    extractFunction('extractCodeByRulePatterns'),
    extractFunction('normalizeMailText'),
    extractFunction('buildMailCodeSearchText'),
    extractFunction('isFreshQqMailListText'),
    extractFunction('extractVerificationCode'),
    extractFunction('handlePollEmail'),
  ].join('\n');

  const api = new Function(`
const currentItems = [
  {
    textContent: 'OpenAI 你的 OpenAI 临时验证码 输入此临时验证码以继续： 454766 1分钟前',
    getAttribute(name) {
      if (name === 'data-mailid') return 'fresh-openai-mail';
      return '';
    },
    querySelector(selector) {
      if (selector === '.cmp-account-nick') return { textContent: 'OpenAI' };
      if (selector === '.mail-subject') return { textContent: '你的 OpenAI 临时验证码' };
      if (selector === '.mail-digest') return { textContent: '输入此临时验证码以继续： 454766 1分钟前' };
      return null;
    },
  },
];

const document = {
  querySelectorAll(selector) {
    if (selector === '.mail-list-page-item[data-mailid]') {
      return currentItems;
    }
    return [];
  },
};

async function waitForElement() {
  return true;
}
async function refreshInbox() {}
async function sleep() {}
function log() {}

${bundle}

return { handlePollEmail };
`)();

  const result = await api.handlePollEmail(8, {
    senderFilters: ['openai', 'forward'],
    subjectFilters: ['verification', 'code', '验证码'],
    maxAttempts: 1,
    intervalMs: 3000,
  });

  assert.equal(result.code, '454766');
  assert.equal(result.mailId, 'fresh-openai-mail');
});
