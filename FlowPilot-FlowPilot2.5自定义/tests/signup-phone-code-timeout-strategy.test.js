const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const source = fs.readFileSync('background/phone-verification-flow.js', 'utf8');
const globalScope = {};
const api = new Function('self', `${source}; return self.MultiPageBackgroundPhoneVerification;`)(globalScope);

// 构造注册短信取码依赖，让测试只关注超时策略分支。
function createSignupPhoneHarness(statePatch = {}) {
  const events = {
    requests: [],
    logs: [],
    states: [],
  };
  const state = {
    phoneCodeWaitSeconds: 15,
    phoneCodeTimeoutWindows: 2,
    phoneCodePollIntervalSeconds: 5,
    phoneCodePollMaxRounds: 1,
    heroSmsApiKey: 'test-key',
    ...statePatch,
  };
  const helpers = api.createPhoneVerificationHelpers({
    addLog: async (message, level, options) => {
      events.logs.push({ message, level, options });
    },
    getState: async () => state,
    setState: async (updates) => {
      events.states.push(updates);
      Object.assign(state, updates);
    },
    sendToContentScript: async () => ({}),
    sendToContentScriptResilient: async () => ({}),
    sleepWithStop: async () => {},
    throwIfStopped: () => {},
    fetchImpl: async (url) => {
      events.requests.push(new URL(url));
      return { ok: true, text: async () => 'STATUS_WAIT_CODE' };
    },
  });
  return { events, helpers, state };
}

// 统计 HeroSMS setStatus(3) 请求次数，用来判断是否请求额外短信。
function countHeroSmsRetryRequests(requests = []) {
  return requests.filter((url) => (
    url.searchParams.get('action') === 'setStatus'
    && url.searchParams.get('status') === '3'
  )).length;
}

test('signup phone timeout strategy resend requests a new SMS before the next wait window', async () => {
  const { events, helpers, state } = createSignupPhoneHarness({
    signupPhoneCodeTimeoutStrategy: 'resend',
  });
  const timeoutWindows = [];
  const activation = {
    activationId: 'signup-activation',
    phoneNumber: '+66123456789',
    provider: 'hero-sms',
    apiKey: 'test-key',
  };

  await assert.rejects(
    helpers.waitForSignupPhoneCode(state, activation, {
      onTimeoutWindow: async (payload) => {
        timeoutWindows.push(payload);
      },
    }),
    /PHONE_CODE_TIMEOUT::/
  );

  assert.equal(countHeroSmsRetryRequests(events.requests), 1);
  assert.equal(timeoutWindows.length, 1);
  assert.equal(timeoutWindows[0].windowIndex, 1);
});

test('signup phone timeout strategy restart keeps current no-resend timeout behavior', async () => {
  const { events, helpers, state } = createSignupPhoneHarness({
    signupPhoneCodeTimeoutStrategy: 'restart',
  });
  const timeoutWindows = [];
  const activation = {
    activationId: 'signup-activation',
    phoneNumber: '+66123456789',
    provider: 'hero-sms',
    apiKey: 'test-key',
  };

  await assert.rejects(
    helpers.waitForSignupPhoneCode(state, activation, {
      onTimeoutWindow: async (payload) => {
        timeoutWindows.push(payload);
      },
    }),
    /PHONE_CODE_TIMEOUT::/
  );

  assert.equal(countHeroSmsRetryRequests(events.requests), 0);
  assert.equal(timeoutWindows.length, 0);
});

test('HeroSMS phone activation stops before trying the next price tier', async () => {
  const events = {
    requests: [],
    logs: [],
    states: [],
  };
  const stopError = new Error('流程已被用户停止。');
  let stopped = false;
  const state = {
    heroSmsApiKey: 'test-key',
    heroSmsCountryId: 52,
    heroSmsCountryLabel: 'South Africa',
    heroSmsMaxPrice: '0.05',
    heroSmsActivationRetryRounds: 2,
  };
  const helpers = api.createPhoneVerificationHelpers({
    addLog: async (message, level, options) => {
      events.logs.push({ message, level, options });
    },
    getState: async () => state,
    setState: async (updates) => {
      events.states.push(updates);
      Object.assign(state, updates);
    },
    sendToContentScript: async () => ({}),
    sendToContentScriptResilient: async () => ({}),
    sleepWithStop: async () => {},
    throwIfStopped: () => {
      if (stopped) {
        throw stopError;
      }
    },
    fetchImpl: async (url) => {
      const parsedUrl = new URL(url);
      events.requests.push(parsedUrl);
      const action = parsedUrl.searchParams.get('action');
      if (action === 'getPrices' || action === 'getPricesExtended') {
        return {
          ok: true,
          text: async () => JSON.stringify({
            service: {
              0.0316: { count: 1 },
              0.045: { count: 1 },
            },
          }),
        };
      }
      if (action === 'getNumber') {
        stopped = true;
        return { ok: true, text: async () => 'NO_NUMBERS' };
      }
      return { ok: true, text: async () => 'NO_NUMBERS' };
    },
  });

  await assert.rejects(
    helpers.requestPhoneActivation(state),
    /流程已被用户停止/
  );

  const getNumberRequests = events.requests.filter((url) => url.searchParams.get('action') === 'getNumber');
  assert.equal(getNumberRequests.length, 1);
  assert.equal(getNumberRequests[0].searchParams.get('maxPrice'), '0.0316');
  assert.equal(
    events.logs.some((entry) => entry.message.includes('价格档位 0.045')),
    false
  );
});
