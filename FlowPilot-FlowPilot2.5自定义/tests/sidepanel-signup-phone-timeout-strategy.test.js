const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const htmlSource = fs.readFileSync('sidepanel/sidepanel.html', 'utf8');
const jsSource = fs.readFileSync('sidepanel/sidepanel.js', 'utf8');

test('sidepanel exposes signup phone timeout strategy controls', () => {
  assert.match(htmlSource, /row-signup-phone-code-timeout-strategy/);
  assert.doesNotMatch(htmlSource, /choice-button/);
  assert.match(htmlSource, /class="choice-btn is-active" data-signup-phone-code-timeout-strategy="restart"/);
  assert.match(htmlSource, /data-signup-phone-code-timeout-strategy="restart"/);
  assert.match(htmlSource, /data-signup-phone-code-timeout-strategy="resend"/);
});

test('sidepanel persists signup phone timeout strategy setting', () => {
  assert.match(jsSource, /signupPhoneCodeTimeoutStrategyButtons/);
  assert.match(jsSource, /function normalizeSignupPhoneCodeTimeoutStrategy/);
  assert.match(jsSource, /signupPhoneCodeTimeoutStrategy:\s*signupPhoneCodeTimeoutStrategyValue/);
  assert.match(jsSource, /setSignupPhoneCodeTimeoutStrategy\(message\.payload\.signupPhoneCodeTimeoutStrategy\)/);
});
