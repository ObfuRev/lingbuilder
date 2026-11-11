// nativeWin32Project 导出模板鼠标事件子类化派发的编译级冒烟（FUTURE_OPTIMIZATIONS 待办收口的回归件）。
// 生成一个绑定 MouseDown/MouseMove/MouseUp 的工程（Label 拖动区 + Button），写最小 vcxproj 后用 MSBuild
// x64/Win32 双平台编译，验证导出形态下子类化派发代码可编译链接（行为顺序红线由 tests/windowDesigner.test.ts 断言钉住）。
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { generateNativeWin32Project } from '../src/services/windowDesigner/nativeWin32Project';
import type { LingWindowProject } from '../src/services/windowDesigner/types';

const execFileAsync = promisify(execFile);

const project: LingWindowProject = {
  schemaVersion: 2,
  id: 'native-mouse-smoke',
  name: '鼠标事件导出冒烟',
  windows: [{
    id: 'main', fileName: 'MainWindow.xml', className: '主窗口', title: '鼠标事件导出冒烟',
    width: 480, height: 320, background: '#202028', description: '',
    controls: [
      { id: 'pad', type: 'Label', name: '画板', content: '拖动区', x: 16, y: 16, width: 300, height: 200,
        events: { MouseDown: '_画板_鼠标按下', MouseMove: '_画板_鼠标移动', MouseUp: '_画板_鼠标抬起' } },
      { id: 'ok', type: 'Button', name: '确定', content: '确定', x: 336, y: 16, width: 110, height: 34,
        events: { MouseDown: '_确定_鼠标按下', Click: '_确定_被单击' } }
    ]
  }] as unknown as LingWindowProject['windows']
};

const eplSourceCode = [
  '.子程序 _画板_鼠标按下',
  '    调试输出 ("画板按下")',
  '.子程序 _画板_鼠标移动',
  '    调试输出 ("画板移动")',
  '.子程序 _画板_鼠标抬起',
  '    信息框 ("画板抬起", 0, "鼠标事件")',
  '.子程序 _确定_鼠标按下',
  '    调试输出 ("按钮按下")',
  '.子程序 _确定_被单击',
  '    调试输出 ("按钮单击")'
].join('\n');

const generated = generateNativeWin32Project(project, { eplSourceCode });
const cpp = generated.files.find(file => file.relativePath.endsWith('.cpp'))!.content;
if (!cpp.includes('GeneratedControlSubclassProc') || !cpp.includes('SetWindowSubclass(child, GeneratedControlSubclassProc')) {
  console.error('FAIL: 生成结果缺少子类化派发');
  process.exit(1);
}

const vswhere = 'C:\\Program Files (x86)\\Microsoft Visual Studio\\Installer\\vswhere.exe';
let installation = '';
try {
  installation = (await execFileAsync(vswhere, ['-latest', '-products', '*', '-requires', 'Microsoft.Component.MSBuild', '-property', 'installationPath'])).stdout.trim();
} catch {
  console.error('SKIP: 未找到 Visual Studio（vswhere 失败），编译冒烟未执行');
  process.exit(0);
}
if (!installation) {
  console.error('SKIP: 未找到 Visual Studio，编译冒烟未执行');
  process.exit(0);
}
const msbuild = path.join(installation, 'MSBuild', 'Current', 'Bin', 'MSBuild.exe');

const root = path.resolve(import.meta.dirname, '..', '..', '.lingbuilder-build', 'native-mouse-smoke');
await fs.rm(root, { recursive: true, force: true });
await fs.mkdir(path.join(root, 'src'), { recursive: true });
await fs.writeFile(path.join(root, 'src', 'main.cpp'), cpp, 'utf8');

const vcxproj = `<?xml version="1.0" encoding="utf-8"?>
<Project DefaultTargets="Build" xmlns="http://schemas.microsoft.com/developer/msbuild/2003">
  <ItemGroup Label="ProjectConfigurations">
    <ProjectConfiguration Include="Release|x64"><Configuration>Release</Configuration><Platform>x64</Platform></ProjectConfiguration>
    <ProjectConfiguration Include="Release|Win32"><Configuration>Release</Configuration><Platform>Win32</Platform></ProjectConfiguration>
  </ItemGroup>
  <PropertyGroup Label="Globals"><ProjectGuid>{7A1C1B2D-3E4F-4A5B-9C6D-0E1F2A3B4C5D}</ProjectGuid><RootNamespace>NativeMouseSmoke</RootNamespace></PropertyGroup>
  <Import Project="$(VCTargetsPath)\\Microsoft.Cpp.Default.props" />
  <PropertyGroup Condition="'$(Configuration)|$(Platform)'=='Release|x64'" Label="Configuration"><ConfigurationType>Application</ConfigurationType><PlatformToolset>v145</PlatformToolset><CharacterSet>Unicode</CharacterSet></PropertyGroup>
  <PropertyGroup Condition="'$(Configuration)|$(Platform)'=='Release|Win32'" Label="Configuration"><ConfigurationType>Application</ConfigurationType><PlatformToolset>v145</PlatformToolset><CharacterSet>Unicode</CharacterSet></PropertyGroup>
  <Import Project="$(VCTargetsPath)\\Microsoft.Cpp.props" />
  <ItemDefinitionGroup>
    <ClCompile><LanguageStandard>stdcpp17</LanguageStandard><WarningLevel>Level3</WarningLevel><AdditionalOptions>/utf-8 %(AdditionalOptions)</AdditionalOptions></ClCompile>
    <Link><AdditionalDependencies>user32.lib;gdi32.lib;comctl32.lib;gdiplus.lib;%(AdditionalDependencies)</AdditionalDependencies><SubSystem>Windows</SubSystem></Link>
  </ItemDefinitionGroup>
  <ItemGroup><ClCompile Include="src\\main.cpp" /></ItemGroup>
  <Import Project="$(VCTargetsPath)\\Microsoft.Cpp.targets" />
</Project>
`;
await fs.writeFile(path.join(root, 'NativeMouseSmoke.vcxproj'), vcxproj, 'utf8');

let failed = false;
for (const platform of ['x64', 'Win32']) {
  try {
    const { stdout } = await execFileAsync(msbuild, ['NativeMouseSmoke.vcxproj', '/m', '/t:Build', '/p:Configuration=Release', `/p:Platform=${platform}`, '/v:minimal', '/nologo'],
      { cwd: root, windowsHide: true, timeout: 6 * 60 * 1000, maxBuffer: 32 * 1024 * 1024 });
    const errors = [...stdout.matchAll(/: error /gu)].length;
    const ok = errors === 0;
    console.log(`${platform}: ${ok ? 'PASS' : 'FAIL'}${ok ? '' : `（${errors} 个 error）`}`);
    if (!ok) console.log(stdout.split('\n').filter(line => line.includes(': error ')).slice(0, 5).join('\n'));
    if (!ok) failed = true;
  } catch (error) {
    console.log(`${platform}: FAIL（${(error as { stdout?: string }).stdout?.split('\n').filter((line: string) => line.includes(': error ')).slice(0, 5).join('\n') || (error as Error).message}）`);
    failed = true;
  }
}
process.exit(failed ? 1 : 0);
