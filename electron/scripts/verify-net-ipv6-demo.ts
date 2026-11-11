// net-ipv6-demo（TCP与UDP IPv6通信演示）长期验收脚本。
// 链路：读工作区项目 → 生成 Win32 工程 → MSBuild 双平台 → 启动 x64 exe →
// Node IPv6 回声服务（::1:9001 TCP + [::]:9001 UDP）→ PowerShell UI 自动化。
// 运行时控件文本的跨进程可读性已实测（2026-11-05 探针）：
//  - GetWindowTextW 读主窗/按钮/单行编辑框/Static 标签/系统提示框 全部可读；
//  - 多行日志框的运行期文本在窗口文本池之外（自绘镜像），读不到——断言一律走
//    「状态标签信标 + 提示框文本 + Node 服务端收包对拍」三条通道；
//  - WM_SETTEXT 写单行编辑框可到达运行时内部存储（demo 自己的 控件_取文本 读得到），
//    跨进程回读显示旧值是文本池未更新，属正常；
//  - PostMessage BM_CLICK 驱动按钮、对话框内 Button 用 SendMessage BM_CLICK 点掉。
// 覆盖：TCP 未连接发送提示、连接成功/失败提示、发送回环、接收、断开；
//       UDP 绑定成功/失败提示、发送回环、接收。
// 用法：cd electron && npx tsx scripts/verify-net-ipv6-demo.ts
import fs from 'node:fs/promises';
import path from 'node:path';
import dgram from 'node:dgram';
import net from 'node:net';
import { execFile, execFileSync, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { BUILTIN_MODULES } from '../src/services/modules/builtinModules';
import type { InstalledModule } from '../src/services/modules/types';
import { generateLingCppNativeWin32Project } from '../src/services/windowDesigner/lingCppWin32Project';
import type { LingWindowProject } from '../src/services/windowDesigner/types';
import { exportVisualStudioProject } from '../src/services/windowDesigner/visualStudioProjectExporter';

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(import.meta.dirname, '..', '..');
const projectId = 'net-ipv6-demo';
const projectDir = path.resolve(repoRoot, '.lingbuilder-build', 'net-ipv6-demo-verify');
const enabledIds = ['lingbuilder.win32.basic', 'lingbuilder.net.tcp', 'lingbuilder.net.udp'];

function builtin(id: string): InstalledModule {
  const manifest = BUILTIN_MODULES.find(item => item.id === id);
  if (!manifest) throw new Error(`缺少内置模块：${id}`);
  return { manifest, installPath: `builtin://${id}`, isBuiltin: true, isInstalled: true, isEnabledForProject: true, diagnostics: [] };
}

async function loadWorkspaceProject() {
  const solution = JSON.parse(await fs.readFile(path.join(repoRoot, '.lingbuilder', 'solution.json'), 'utf8')) as {
    projects: Array<{ id: string; name: string; sourceRoot: string; designerPath: string }>;
  };
  const entry = solution.projects.find(item => item.id === projectId);
  if (!entry) throw new Error(`solution.json 缺少项目 ${projectId}（请先注册）`);
  const designer = JSON.parse(await fs.readFile(path.join(repoRoot, entry.designerPath), 'utf8')) as LingWindowProject;
  const source = await fs.readFile(path.join(repoRoot, entry.sourceRoot, 'MainWindow.lcpp'), 'utf8');
  return { designer, source };
}

// Node 侧回声服务：TCP ::1:9001 原样回发；UDP [::]:9001（双栈）原样回发来源地址。
function startEchoServers() {
  const received: Array<{ proto: string; text: string; from: string }> = [];
  const tcpServer = net.createServer(socket => {
    socket.on('data', data => {
      received.push({ proto: 'tcp', text: data.toString('utf8'), from: String(socket.remoteAddress) });
      socket.write(data);
    });
  });
  const udpServer = dgram.createSocket({ type: 'udp6', ipv6Only: false });
  udpServer.on('message', (message, rinfo) => {
    received.push({ proto: 'udp', text: message.toString('utf8'), from: `${rinfo.address}:${rinfo.port}` });
    udpServer.send(message, rinfo.port, rinfo.address);
  });
  return {
    received,
    listen: Promise.all([
      new Promise<void>(resolve => tcpServer.listen(9001, '::1', resolve)),
      new Promise<void>(resolve => udpServer.bind(9001, '::', resolve))
    ]),
    close: () => {
      tcpServer.close();
      udpServer.close();
    }
  };
}

// PowerShell 驱动脚本（utf-8-sig，中文文本直接烘焙——PS5.1 无 BOM 必乱码）。
// 输出统一 ASCII：每步一行 RESULT|<name>|<PASS|FAIL>，退出码 0/1。
function buildDriverScript(pid: number): string {
  return `$ErrorActionPreference = 'Stop'
$TargetPid = ${pid}
Add-Type -TypeDefinition @"
using System;
using System.Text;
using System.Runtime.InteropServices;
public class W32Net {
    public delegate bool EnumProc(IntPtr hWnd, IntPtr lParam);
    [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr lParam);
    [DllImport("user32.dll")] public static extern bool EnumChildWindows(IntPtr parent, EnumProc cb, IntPtr lParam);
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT r);
    public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowTextW(IntPtr hWnd, StringBuilder text, int max);
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassNameW(IntPtr hWnd, StringBuilder text, int max);
    [DllImport("user32.dll", EntryPoint="SendMessageW", CharSet=CharSet.Unicode)] public static extern IntPtr SendSetText(IntPtr hWnd, uint msg, IntPtr wp, string lp);
    [DllImport("user32.dll", EntryPoint="SendMessageW")] public static extern IntPtr SendMsg(IntPtr hWnd, uint msg, IntPtr wp, IntPtr lp);
    [DllImport("user32.dll", EntryPoint="PostMessageW")] public static extern bool PostMsg(IntPtr hWnd, uint msg, IntPtr wp, IntPtr lp);
}
"@
$script:Results = New-Object System.Collections.ArrayList
$script:MainHwnd = [IntPtr]::Zero
$script:Buttons = @{}
$script:Edits = New-Object System.Collections.ArrayList
$script:TcpStatusLabel = [IntPtr]::Zero
$script:UdpStatusLabel = [IntPtr]::Zero
$WM_SETTEXT = 0x000C; $BM_CLICK = 0x00F5

function GWT([IntPtr]$h) {
    $sb = New-Object System.Text.StringBuilder 2048
    [void][W32Net]::GetWindowTextW($h, $sb, 2048)
    return $sb.ToString()
}
function Get-WindowPid([IntPtr]$h) {
    $wpid = [System.UInt32]0
    [void][W32Net]::GetWindowThreadProcessId($h, [ref]$wpid)
    return [int]$wpid
}
function Collect-Main {
    $found = New-Object System.Collections.ArrayList
    $cb = [W32Net+EnumProc]{ param([IntPtr]$h, [IntPtr]$l)
        if ([W32Net]::IsWindowVisible($h) -and ((Get-WindowPid $h) -eq $TargetPid)) {
            $t = New-Object System.Text.StringBuilder 512
            [void][W32Net]::GetWindowTextW($h, $t, 512)
            $c = New-Object System.Text.StringBuilder 128
            [void][W32Net]::GetClassNameW($h, $c, 128)
            [void]$found.Add(@{ Hwnd = $h; Title = $t.ToString(); Class = $c.ToString() })
        }
        return $true
    }
    [void][W32Net]::EnumWindows($cb, [IntPtr]::Zero)
    foreach ($w in $found) {
        if (($w.Class -ne '#32770') -and ($w.Title.Length -gt 0)) { $script:MainHwnd = $w.Hwnd; break }
    }
    return $script:MainHwnd -ne [IntPtr]::Zero
}
function Collect-Children {
    $script:Buttons.Clear()
    [void]$script:Edits.Clear()
    $script:TcpStatusLabel = [IntPtr]::Zero
    $script:UdpStatusLabel = [IntPtr]::Zero
    $cb = [W32Net+EnumProc]{ param([IntPtr]$h, [IntPtr]$l)
        $c = New-Object System.Text.StringBuilder 128
        [void][W32Net]::GetClassNameW($h, $c, 128)
        $cls = $c.ToString()
        $text = GWT $h
        if ($cls -eq 'Button') { $script:Buttons[$text] = $h }
        elseif ($cls -eq 'Edit') {
            $r = New-Object W32Net+RECT
            [void][W32Net]::GetWindowRect($h, [ref]$r)
            [void]$script:Edits.Add(@{ Hwnd = $h; Text = $text; Y = $r.Top })
        }
        elseif ($cls -eq 'Static') {
            if ($text -eq 'TCP：未连接') { $script:TcpStatusLabel = $h }
            elseif ($text -eq 'UDP：未绑定') { $script:UdpStatusLabel = $h }
        }
        return $true
    }
    [void][W32Net]::EnumChildWindows($script:MainHwnd, $cb, [IntPtr]::Zero)
    return $true
}
function Wait-Label([IntPtr]$label, [string]$needle, [int]$seconds) {
    $deadline = [DateTime]::UtcNow.AddSeconds($seconds)
    while ([DateTime]::UtcNow -lt $deadline) {
        if ($label -ne [IntPtr]::Zero) {
            if ((GWT $label).Contains($needle)) { return $true }
        }
        Start-Sleep -Milliseconds 200
    }
    return $false
}
# 等待提示框出现并读取其 Static 文本（弹窗是系统 MessageBox，文本跨进程可读），读完整入后点「确定」关闭。
function Wait-Dialog([string]$needle, [int]$seconds) {
    $deadline = [DateTime]::UtcNow.AddSeconds($seconds)
    while ([DateTime]::UtcNow -lt $deadline) {
        $dialogs = New-Object System.Collections.ArrayList
        $cb = [W32Net+EnumProc]{ param([IntPtr]$h, [IntPtr]$l)
            $c = New-Object System.Text.StringBuilder 64
            [void][W32Net]::GetClassNameW($h, $c, 64)
            if (($c.ToString() -eq '#32770') -and [W32Net]::IsWindowVisible($h) -and ((Get-WindowPid $h) -eq $TargetPid)) { [void]$dialogs.Add($h) }
            return $true
        }
        [void][W32Net]::EnumWindows($cb, [IntPtr]::Zero)
        if ($dialogs.Count -gt 0) {
            $texts = New-Object System.Collections.ArrayList
            $btns = New-Object System.Collections.ArrayList
            $dcb = [W32Net+EnumProc]{ param([IntPtr]$h, [IntPtr]$l)
                $c = New-Object System.Text.StringBuilder 64
                [void][W32Net]::GetClassNameW($h, $c, 64)
                if ($c.ToString() -eq 'Static') { [void]$script:dlgTexts.Add((GWT $h)) }
                elseif ($c.ToString() -eq 'Button') { [void]$script:dlgBtns.Add($h) }
                return $true
            }
            $script:dlgTexts = New-Object System.Collections.ArrayList
            $script:dlgBtns = New-Object System.Collections.ArrayList
            [void][W32Net]::EnumChildWindows($dialogs[0], $dcb, [IntPtr]::Zero)
            $joined = [System.String]::Join(' | ', ($script:dlgTexts | Where-Object { $_ -ne '' }))
            $hit = $joined.Contains($needle)
            if ($script:dlgBtns.Count -gt 0) { [void][W32Net]::SendMsg($script:dlgBtns[0], $BM_CLICK, [IntPtr]::Zero, [IntPtr]::Zero) }
            Start-Sleep -Milliseconds 300
            return @{ Hit = $hit; Text = $joined }
        }
        Start-Sleep -Milliseconds 150
    }
    return @{ Hit = $false; Text = '(timeout)' }
}
function Click-Button([string]$name) {
    if (-not $script:Buttons.ContainsKey($name)) { throw ('button not found: ' + $name) }
    [void][W32Net]::PostMsg($script:Buttons[$name], $BM_CLICK, [IntPtr]::Zero, [IntPtr]::Zero)
}
# WM_SETTEXT 写单行编辑框：到达运行时内部存储（demo 的 控件_取文本 读得到），跨进程回读旧值属正常。
function Set-EditByNeedle([string]$needle, [string]$value) {
    $target = [IntPtr]::Zero
    foreach ($e in $script:Edits) { if ($e.Text.Contains($needle)) { $target = $e.Hwnd; break } }
    if ($target -eq [IntPtr]::Zero) { throw ('edit not found: ' + $needle) }
    [void][W32Net]::SendSetText($target, $WM_SETTEXT, [IntPtr]::Zero, $value)
}
# 端口两个编辑框默认值都是 9001：按屏幕 Y 坐标区分（上=TCP端口，下=UDP目标端口）。
function Set-PortEdit([bool]$upper, [string]$value) {
    $candidates = @($script:Edits | Where-Object { $_.Text -eq '9001' } | Sort-Object { $_.Y })
    if ($candidates.Count -lt 2) { throw 'port edits not found' }
    $target = [IntPtr]::Zero
    if ($upper) { $target = $candidates[0].Hwnd } else { $target = $candidates[$candidates.Count - 1].Hwnd }
    [void][W32Net]::SendSetText($target, $WM_SETTEXT, [IntPtr]::Zero, $value)
}
function Record([string]$name, [bool]$ok) {
    [void]$script:Results.Add(('RESULT|' + $name + '|' + $(if ($ok) { 'PASS' } else { 'FAIL' })))
}

$ok = Collect-Main
Record 'main-window-found' $ok
if (-not $ok) { $script:Results | ForEach-Object { Write-Output $_ }; exit 1 }
Start-Sleep -Milliseconds 1500
[void](Collect-Children)
Record 'controls-found' (($script:Buttons.Count -ge 8) -and ($script:Edits.Count -ge 8) -and ($script:TcpStatusLabel -ne [IntPtr]::Zero) -and ($script:UdpStatusLabel -ne [IntPtr]::Zero))

# 1) TCP 未连接时点「发送数据」→ 弹「TCP 尚未连接」提示
Click-Button '发送数据'
$d = Wait-Dialog 'TCP 尚未连接' 6
Record 'tcp-send-not-connected-dialog' $d.Hit

# 2) TCP 连接成功 → 弹「TCP 连接结果」提示（文本含连接成功）
Click-Button '连接'
$d = Wait-Dialog 'TCP 连接成功' 8
Record 'tcp-connect-success-dialog' $d.Hit

# 3) TCP 发送 → 状态标签「已发送 N 字节」+ 服务端收到正文
Set-EditByNeedle 'TCP 发送' 'IPv6ABCTest123'
Click-Button '发送数据'
Record 'tcp-send-status' (Wait-Label $script:TcpStatusLabel 'TCP：已发送' 6)

# 4) TCP 接收回声 → 状态标签「已收到数据」
Click-Button '接收数据'
Record 'tcp-recv-status' (Wait-Label $script:TcpStatusLabel 'TCP：已收到数据' 8)

# 5) TCP 连接失败（19999 无服务端）→ 弹失败提示；恢复端口
Set-PortEdit $true '19999'
Click-Button '连接'
$d = Wait-Dialog 'TCP 连接失败' 8
Record 'tcp-connect-fail-dialog' $d.Hit
Set-PortEdit $true '9001'

# 6) TCP 断开 → 状态标签回到「TCP：未连接」
Click-Button '断开连接'
Record 'tcp-disconnect-status' (Wait-Label $script:TcpStatusLabel 'TCP：未连接' 6)

# 7) UDP 绑定成功 → 状态标签「已绑定端口」
Click-Button '绑定端口'
Record 'udp-bind-status' (Wait-Label $script:UdpStatusLabel 'UDP：已绑定端口' 6)

# 8) UDP 发送 → 状态标签「已发送数据报」+ 服务端收到正文
Set-EditByNeedle 'UDP 你好' 'UDPv6XYZ789'
Click-Button '发送数据报'
Record 'udp-send-status' (Wait-Label $script:UdpStatusLabel 'UDP：已发送数据报' 6)

# 9) UDP 接收回声 → 状态标签「已收到数据报」
Click-Button '接收数据报'
Record 'udp-recv-status' (Wait-Label $script:UdpStatusLabel 'UDP：已收到数据报' 8)

# 10) UDP 绑定失败 → 弹失败提示。Node dgram 默认 SO_REUSEADDR，双绑在 Windows 会成功，
# 占用必须由驱动自己起一个无 REUSEADDR 的 .NET UDP 套接字来模拟。
$blockerPort = 0
foreach ($p in @(9101, 9102, 9103, 9104)) {
    try {
        $probe = New-Object System.Net.Sockets.Socket ([System.Net.Sockets.AddressFamily]::InterNetworkV6, [System.Net.Sockets.SocketType]::Dgram, [System.Net.Sockets.ProtocolType]::Udp)
        $probe.SetSocketOption([System.Net.Sockets.SocketOptionLevel]::IPv6, [System.Net.Sockets.SocketOptionName]::IPv6Only, $false)
        $probe.Bind((New-Object System.Net.IPEndPoint ([System.Net.IPAddress]::IPv6Any, $p)))
        $probe.Close()
        $blockerPort = $p
        break
    } catch { }
}
if ($blockerPort -gt 0) {
    # 占位套接字必须与 demo 同型（AF_INET6 + V6ONLY=0 双栈通配）：Windows 上 V6ONLY=1 的占位
    # 与双栈通配绑定不冲突（2026-11-05 实测），只有同型占位才产生 WSAEADDRINUSE。
    $script:blocker = New-Object System.Net.Sockets.Socket ([System.Net.Sockets.AddressFamily]::InterNetworkV6, [System.Net.Sockets.SocketType]::Dgram, [System.Net.Sockets.ProtocolType]::Udp)
    $script:blocker.SetSocketOption([System.Net.Sockets.SocketOptionLevel]::IPv6, [System.Net.Sockets.SocketOptionName]::IPv6Only, $false)
    $script:blocker.Bind((New-Object System.Net.IPEndPoint ([System.Net.IPAddress]::IPv6Any, $blockerPort)))
    # UDP本机端口编辑框按初始文本 '9002' 定位一次（文本池跨进程读旧值，不能二次按文本找）
    $udpLocalEdit = [IntPtr]::Zero
    foreach ($e in $script:Edits) { if ($e.Text -eq '9002') { $udpLocalEdit = $e.Hwnd; break } }
    [void][W32Net]::SendSetText($udpLocalEdit, $WM_SETTEXT, [IntPtr]::Zero, ([string]$blockerPort))
    Click-Button '绑定端口'
    $d = Wait-Dialog 'UDP 绑定失败' 8
    Record 'udp-bind-fail-dialog' $d.Hit
    [void][W32Net]::SendSetText($udpLocalEdit, $WM_SETTEXT, [IntPtr]::Zero, '9002')
    $script:blocker.Close()
} else {
    Record 'udp-bind-fail-dialog' $false
}

$script:Results | ForEach-Object { Write-Output $_ }
$failed = @($script:Results | Where-Object { $_.EndsWith('|FAIL') })
if ($failed.Count -gt 0) { exit 1 } else { exit 0 }
`;
}

async function main() {
  const { designer, source } = await loadWorkspaceProject();
  const servers = startEchoServers();
  await servers.listen;
  try {
    const generated = generateLingCppNativeWin32Project(designer, {
      activeWindowId: designer.windows[0]?.id,
      lingCppSources: [{ filePath: 'MainWindow.lcpp', sourceCode: source }],
      enabledModules: enabledIds.map(builtin)
    });
    if (generated.blockingDiagnostics.length) throw new Error(`生成阻断：\n${generated.blockingDiagnostics.join('\n')}`);
    await fs.rm(projectDir, { recursive: true, force: true });
    await fs.mkdir(projectDir, { recursive: true });
    for (const file of generated.files) {
      const target = path.resolve(projectDir, file.relativePath);
      if (!target.startsWith(`${projectDir}${path.sep}`)) throw new Error(`生成文件越界：${file.relativePath}`);
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, file.content, 'utf8');
    }
    await fs.mkdir(path.join(projectDir, 'resources'), { recursive: true });
    await fs.copyFile(path.join(repoRoot, 'image', 'lingbuilder-ide-icon-v1.ico'), path.join(projectDir, 'resources', 'lingbuilder-app.ico'));
    const exported = await exportVisualStudioProject({ projectDir, projectId, generatedFiles: generated.files, enabledModules: enabledIds.map(builtin) });
    const vswhere = path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Microsoft Visual Studio', 'Installer', 'vswhere.exe');
    const installation = (await execFileAsync(vswhere, ['-latest', '-products', '*', '-requires', 'Microsoft.VisualStudio.Component.VC.Tools.x86.x64', '-property', 'installationPath'], { windowsHide: true })).stdout.trim();
    const msbuild = path.join(installation, 'MSBuild', 'Current', 'Bin', 'MSBuild.exe');
    for (const platform of ['Win32', 'x64']) {
      await execFileAsync(msbuild, [exported.solutionPath, '/m', '/t:Build', '/p:Configuration=Release', `/p:Platform=${platform}`, '/v:minimal', '/nologo'], { cwd: projectDir, windowsHide: true, timeout: 10 * 60 * 1000, maxBuffer: 32 * 1024 * 1024 });
    }
    const binDir = path.join(projectDir, 'x64', 'Release', 'bin');
    const executable = path.join(binDir, `${exported.projectName}.exe`);
    // 清场：上次验收残留的同名 exe 与探针实例（同名互杀红线：先按镜像名清场再启动）
    try { execFileSync('taskkill', ['/IM', `${exported.projectName}.exe`, '/F'], { stdio: 'ignore' }); } catch { /* 无残留 */ }
    const child = spawn(executable, [], { cwd: binDir, stdio: 'ignore', detached: false });
    const drivePath = path.join(projectDir, 'drive.ps1');
    await fs.writeFile(drivePath, '\ufeff' + buildDriverScript(child.pid), 'utf8');
    await new Promise(resolve => setTimeout(resolve, 3000));
    let stdout = '';
    let driverError: string | undefined;
    try {
      const run = await execFileAsync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', drivePath], { timeout: 180 * 1000, maxBuffer: 1024 * 1024, windowsHide: true });
      stdout = run.stdout;
    } catch (error) {
      const err = error as { stdout?: string; stderr?: string; message?: string };
      stdout = String(err.stdout || '');
      driverError = String(err.stderr || err.message || '').slice(0, 3000);
    } finally {
      try { execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' }); } catch { /* 已退出 */ }
    }
    const lines = stdout.split(/\r?\n/).filter(line => line.startsWith('RESULT|'));
    const failures = lines.filter(line => line.endsWith('|FAIL'));
    const serverSeenTcp = servers.received.some(item => item.proto === 'tcp' && item.text.includes('IPv6ABCTest123'));
    const serverSeenUdp = servers.received.some(item => item.proto === 'udp' && item.text.includes('UDPv6XYZ789'));
    const summary = {
      ok: failures.length === 0 && serverSeenTcp && serverSeenUdp,
      results: lines,
      serverSeenTcp,
      serverSeenUdp,
      serverReceived: servers.received,
      driverError,
      executable
    };
    console.log(JSON.stringify(summary, null, 2));
    if (failures.length || !serverSeenTcp || !serverSeenUdp) process.exitCode = 1;
  } finally {
    servers.close();
  }
}

main().catch(error => { console.error(error instanceof Error ? error.stack || error.message : error); process.exitCode = 1; });
