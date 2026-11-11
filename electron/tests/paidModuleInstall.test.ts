import assert from 'node:assert/strict';
import test from 'node:test';
import { installModuleWithPaidAccessRetry, type ModuleInstallApiResponse } from '../src/services/modules/paidModuleInstall';

const PAID_MODULE = 'lingbuilder.aoahid';

function paidBlocked(error = '本机还没有该模块的可用授权：登录 LingBuilder 账号后重试即可自动换发'): ModuleInstallApiResponse {
  return { ok: false, code: 'MODULE_PAYMENT_REQUIRED', error };
}

test('安装命中模块权益 402 时先换发授权再重试一次，成功后返回第二次结果', async () => {
  const calls: string[] = [];
  const blocked: string[] = [];
  const result = await installModuleWithPaidAccessRetry({
    moduleId: PAID_MODULE,
    moduleName: 'AOA HID 安卓真机触控模块',
    install: async (): Promise<ModuleInstallApiResponse> => {
      calls.push('install');
      return calls.length === 1
        ? paidBlocked()
        : { ok: true, result: { moduleId: PAID_MODULE, moduleName: 'AOA HID 安卓真机触控模块', version: '1.1.2' } };
    },
    recoverAccess: async (moduleId, moduleName) => {
      calls.push(`recover:${moduleId}:${moduleName}`);
      return true;
    },
    onBlocked: response => blocked.push(String(response.error)),
    onRecovered: () => calls.push('recovered')
  });
  assert.equal(result.ok, true);
  // 顺序：安装 → 换发 → 重试；绝不并发换发或无限重试。
  assert.deepEqual(calls, [
    'install',
    `recover:${PAID_MODULE}:AOA HID 安卓真机触控模块`,
    'recovered',
    'install'
  ]);
  assert.equal(blocked.length, 1);
});

test('换发失败时保留首个 402 响应且不重试安装', async () => {
  let installCalls = 0;
  let recoverCalls = 0;
  const first = paidBlocked('当前账号没有该模块的有效权益。');
  const result = await installModuleWithPaidAccessRetry({
    moduleId: PAID_MODULE,
    install: async () => {
      installCalls += 1;
      return first;
    },
    recoverAccess: async () => {
      recoverCalls += 1;
      return false;
    }
  });
  assert.equal(result, first);
  assert.equal(installCalls, 1);
  assert.equal(recoverCalls, 1);
});

test('安装成功或非权益类失败时不触发换发', async () => {
  const cases = [
    { ok: true, result: {} },
    { ok: false, code: 'MODULE_PACKAGE_INVALID', error: '模块包清单无效。' }
  ];
  for (const response of cases) {
    let recoverCalls = 0;
    const result = await installModuleWithPaidAccessRetry({
      moduleId: PAID_MODULE,
      install: async () => response,
      recoverAccess: async () => {
        recoverCalls += 1;
        return true;
      }
    });
    assert.equal(result, response);
    assert.equal(recoverCalls, 0);
  }
});

test('缺少模块 ID 时不进入换发（无法定位权益对象）', async () => {
  let recoverCalls = 0;
  const blocked = paidBlocked();
  const result = await installModuleWithPaidAccessRetry({
    moduleId: '',
    install: async () => blocked,
    recoverAccess: async () => {
      recoverCalls += 1;
      return true;
    }
  });
  assert.equal(result, blocked);
  assert.equal(recoverCalls, 0);
});
