const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const source = fs.readFileSync('sidepanel/sidepanel.js', 'utf8');

function extractFunction(name) {
  const markers = [`async function ${name}(`, `function ${name}(`];
  const start = markers
    .map((marker) => source.indexOf(marker))
    .find((index) => index >= 0);
  assert.notEqual(start, -1, `missing ${name}`);

  let parenDepth = 0;
  let signatureEnded = false;
  let braceStart = -1;
  for (let i = start; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === '(') parenDepth += 1;
    if (ch === ')') {
      parenDepth -= 1;
      if (parenDepth === 0) signatureEnded = true;
    }
    if (ch === '{' && signatureEnded) {
      braceStart = i;
      break;
    }
  }

  let depth = 0;
  for (let i = braceStart; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === '{') depth += 1;
    if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        return source.slice(start, i + 1);
      }
    }
  }
  throw new Error(`unterminated ${name}`);
}

test('sidepanel log export builds readable text content', () => {
  const bundle = [
    extractFunction('formatLogEntryForExport'),
    extractFunction('buildLogExportContent'),
  ].join('\n');

  const api = new Function(`
const DISPLAY_TIMEZONE = 'Asia/Shanghai';
const LOG_LEVEL_LABELS = { info: '信息', warn: '警告', error: '错误', ok: '成功' };
${bundle}
return { buildLogExportContent };
`)();

  const content = api.buildLogExportContent([
    {
      timestamp: new Date('2026-05-27T06:28:57.000Z').getTime(),
      level: 'info',
      step: 10,
      message: '邮箱验证码页面已就绪，开始获取验证码。',
    },
    {
      timestamp: new Date('2026-05-27T06:29:04.000Z').getTime(),
      level: 'warn',
      step: 10,
      message: 'QQ 邮箱 内容脚本 5 秒内未响应，请刷新页面后重试。',
    },
  ]);

  assert.match(content, /2026\/5\/27 14:28:57 信息 步10 邮箱验证码页面已就绪/);
  assert.match(content, /2026\/5\/27 14:29:04 警告 步10 QQ 邮箱 内容脚本/);
});

test('sidepanel log export builds timestamped file name', () => {
  const api = new Function(`
const DISPLAY_TIMEZONE = 'Asia/Shanghai';
${extractFunction('buildLogExportFileName')}
return { buildLogExportFileName };
`)();

  assert.equal(
    api.buildLogExportFileName(new Date('2026-05-27T06:28:57.000Z')),
    'flowpilot-log-20260527142857.txt'
  );
});
