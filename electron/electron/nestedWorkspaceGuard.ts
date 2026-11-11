import fs from 'node:fs/promises';
import path from 'node:path';

export interface NestedWorkspaceArtifactPlan {
  detected: boolean;
  excludedAbsolutePaths: Set<string>;
}

const EMPTY_PLAN: NestedWorkspaceArtifactPlan = {
  detected: false,
  excludedAbsolutePaths: new Set<string>()
};

// Electron 主进程使用独立 tsconfig/rootDir，因此在主进程边界保留同等的路径守卫。
export async function detectNestedWorkspaceArtifacts(sourceRoot: string): Promise<NestedWorkspaceArtifactPlan> {
  // 排除清单必须与 copyAbsoluteTree 的 realSource（fs.realpath 展开）同形态：Windows 下
  // os.tmpdir() 可能是 8.3 短名（ADMINI~1），path.resolve 不展开而 fs.realpath 展开——
  // 两侧不同源时 isNestedWorkspaceArtifactPath 永不命中，嵌套工作区文件会漏进源码包。
  let resolvedRoot = path.resolve(sourceRoot);
  try {
    resolvedRoot = path.resolve(await fs.realpath(resolvedRoot));
  } catch {
    // 根不存在时按 resolve 形态继续（后面 stat 同样失败 → EMPTY_PLAN）。
  }
  try {
    const marker = await fs.stat(path.join(resolvedRoot, '.lingbuilder', 'solution.json'));
    if (!marker.isFile()) return EMPTY_PLAN;
    const entries = await fs.readdir(resolvedRoot, { withFileTypes: true });
    const solutionEntries = entries.filter(entry => entry.isFile() && entry.name.toLocaleLowerCase().endsWith('.lbsln'));
    if (solutionEntries.length === 0) return EMPTY_PLAN;
    return {
      detected: true,
      excludedAbsolutePaths: new Set([
        path.resolve(resolvedRoot, '.lingbuilder'),
        path.resolve(resolvedRoot, 'config'),
        path.resolve(resolvedRoot, 'src'),
        ...solutionEntries.map(entry => path.resolve(resolvedRoot, entry.name))
      ].map(item => item.toLocaleLowerCase()))
    };
  } catch {
    return EMPTY_PLAN;
  }
}

export function isNestedWorkspaceArtifactPath(absolutePath: string, plan: NestedWorkspaceArtifactPlan): boolean {
  if (!plan.detected) return false;
  const normalized = path.resolve(absolutePath).toLocaleLowerCase();
  return [...plan.excludedAbsolutePaths].some(excluded => normalized === excluded || normalized.startsWith(`${excluded}${path.sep}`));
}
