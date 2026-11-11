import { generateLingCppNativeWin32Project } from '../src/services/windowDesigner/lingCppWin32Project';
import { BUILTIN_MODULES } from '../src/services/modules/builtinModules';
import { readFileSync } from 'node:fs';
// 复刻 fbroSwitchProject（从测试里读不行，手工看定义后造）
