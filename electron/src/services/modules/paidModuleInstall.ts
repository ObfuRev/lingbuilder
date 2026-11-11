import { isPaidModuleAccessErrorCode } from './paidModuleAccessRecovery';

/** /api/modules/package/install 的最小响应形状（其余字段由调用方原样透传）。 */
export interface ModuleInstallApiResponse {
  ok: boolean;
  code?: string;
  error?: string;
  [key: string]: unknown;
}

export interface InstallWithPaidAccessRetryOptions<T extends ModuleInstallApiResponse> {
  moduleId: string;
  moduleName?: string;
  install: () => Promise<T>;
  /** 共享恢复流（recoverPaidModuleAccess）；返回 true 表示授权已就绪，可重试一次安装。 */
  recoverAccess: (moduleId: string, moduleName: string) => Promise<boolean>;
  /** 首次命中授权门禁时回调（用于提示「正在自动换发授权…」）。 */
  onBlocked?: (response: T) => void;
  /** 换发成功、即将重试安装时回调。 */
  onRecovered?: () => void;
}

/**
 * 收费模块安装的唯一重试口径：安装响应的 code 属于模块权益失败码时，
 * 先走共享恢复流换发 Permit 并同步本地服务，再重试一次原安装请求。
 *
 * 背景：云端「账号已授权」（Pro 会员/已购买）只说明账号有权益，安装门禁还要本机有 Permit；
 * 换机、重装、登录后首次安装都会出现「云端已授权、本机无 Permit」，直接用「请先购买」拦下是误判。
 * 恢复失败时原样返回首个 402 响应，调用方据此终止并展示恢复流给出的中文原因。
 */
export async function installModuleWithPaidAccessRetry<T extends ModuleInstallApiResponse>(
  options: InstallWithPaidAccessRetryOptions<T>
): Promise<T> {
  const first = await options.install();
  if (first.ok || !options.moduleId || !isPaidModuleAccessErrorCode(first.code)) return first;
  options.onBlocked?.(first);
  const recovered = await options.recoverAccess(options.moduleId, options.moduleName || options.moduleId);
  if (!recovered) return first;
  options.onRecovered?.();
  return await options.install();
}
