const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const source = fs.readFileSync('background.js', 'utf8');

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

test('markCurrentRegistrationAccountUsed uses fresh state when checkout passes stale state', async () => {
  const bundle = extractFunction('markCurrentRegistrationAccountUsed');
  const factory = new Function(`
const patchCalls = [];
const logs = [];
async function getState() {
  return {
    mailProvider: 'hotmail',
    currentHotmailAccountId: 'hot-1',
    email: 'fresh@example.com',
  };
}
function isHotmailProvider(state) {
  return String(state.mailProvider || '').toLowerCase() === 'hotmail';
}
function isLuckmailProvider() {
  return false;
}
function getCurrentLuckmailPurchase() {
  return null;
}
async function patchHotmailAccount(id, updates) {
  patchCalls.push({ id, updates });
}
async function setLuckmailPurchaseUsedState() {}
async function clearLuckmailRuntimeState() {}
async function patchMail2925Account() {}
async function finalizeIcloudAliasAfterSuccessfulFlow() {
  return { handled: false };
}
async function markCurrentCustomEmailPoolEntryUsed() {
  return { updated: false };
}
async function addLog(message, level) {
  logs.push({ message, level });
}

${bundle}

return { markCurrentRegistrationAccountUsed, patchCalls, logs };
`);
  const api = factory();

  const result = await api.markCurrentRegistrationAccountUsed({ email: 'stale@example.com' }, {
    logPrefix: 'Plus Checkout：当前账号没有免费试用资格',
  });

  assert.equal(result.updated, true);
  assert.equal(api.patchCalls.length, 1);
  assert.equal(api.patchCalls[0].id, 'hot-1');
  assert.equal(api.patchCalls[0].updates.used, true);
  assert.equal(api.logs.some((entry) => /Hotmail 账号已标记为已用/.test(entry.message)), true);
});

test('markCurrentRegistrationAccountUsed clears mail2925 runtime email after successful flow', async () => {
  const bundle = extractFunction('markCurrentRegistrationAccountUsed');
  const factory = new Function(`
const patchCalls = [];
const logs = [];
const stateUpdates = [];
async function getState() {
  return {
    mailProvider: '2925',
    currentMail2925AccountId: 'mail-2925-1',
    email: 'demo123456@2925.com',
    registrationEmailState: {
      current: 'demo123456@2925.com',
      previous: 'demo123456@2925.com',
      source: 'flow',
      updatedAt: 1,
    },
  };
}
function isHotmailProvider() {
  return false;
}
function isLuckmailProvider() {
  return false;
}
function getCurrentLuckmailPurchase() {
  return null;
}
async function patchHotmailAccount() {}
async function setLuckmailPurchaseUsedState() {}
async function clearLuckmailRuntimeState() {}
async function patchMail2925Account(id, updates) {
  patchCalls.push({ id, updates });
}
async function finalizeIcloudAliasAfterSuccessfulFlow() {
  return { handled: false };
}
async function markCurrentCustomEmailPoolEntryUsed() {
  return { updated: false };
}
async function addLog(message, level) {
  logs.push({ message, level });
}
async function setState(updates) {
  stateUpdates.push(updates);
}
function broadcastDataUpdate(updates) {
  stateUpdates.push({ broadcast: updates });
}

${bundle}

return { markCurrentRegistrationAccountUsed, patchCalls, logs, stateUpdates };
`);
  const api = factory();

  const result = await api.markCurrentRegistrationAccountUsed({}, {
    logPrefix: '流程完成',
    level: 'ok',
  });

  assert.equal(result.updated, true);
  assert.equal(api.patchCalls.length, 1);
  assert.equal(api.patchCalls[0].id, 'mail-2925-1');
  assert.deepStrictEqual(api.stateUpdates[0], {
    email: null,
    registrationEmailState: null,
  });
  assert.deepStrictEqual(api.stateUpdates[1], {
    broadcast: {
      email: null,
      registrationEmailState: null,
    },
  });
  assert.equal(api.logs.some((entry) => /2925 账号已记录最近使用时间/.test(entry.message)), true);
  assert.equal(api.logs.some((entry) => /2925 邮箱运行态已清空/.test(entry.message)), true);
});
