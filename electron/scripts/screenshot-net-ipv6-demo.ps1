# net-ipv6-demo 成功态截图验收（配套 electron/scripts/verify-net-ipv6-demo.ts 使用）。
# 前置：verify-net-ipv6-demo.ts 已生成并编译出 exe（本脚本直接复用，不重新构建）。
# 链路：PowerShell 内嵌 TCP/UDP IPv6 回声服务（runspace）→ 启动 exe → UI 自动化点击 →
#       在 TCP 连接成功/发送接收成功/UDP 绑定/UDP 收发成功时刻 PrintWindow 抓窗。
# 产出：examples/net-ipv6-demo/验收截图/*.png（提示框与主窗状态标签+日志同框为证）。
# 运行：cd electron && powershell -NoProfile -ExecutionPolicy Bypass -File scripts\screenshot-net-ipv6-demo.ps1
# 注意：内嵌回声服务是阻塞 runspace，脚本主流程结束后 powershell 进程会挂住不退出——
# 属已知现象，用以下命令按命令行精确清场（勿按镜像名误杀其他 powershell）：
#   Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" |
#     ? { $_.CommandLine -like '*screenshot-net-ipv6-demo*' } | % { Stop-Process -Id $_.ProcessId -Force }
$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$outDir = Join-Path $repoRoot 'examples\net-ipv6-demo\验收截图'
New-Item -ItemType Directory -Force -Path $outDir | Out-Null
$exe = Join-Path $repoRoot '.lingbuilder-build\net-ipv6-demo-verify\x64\Release\bin\net-ipv6-demo.exe'
if (-not (Test-Path $exe)) { Write-Output 'MISSING-EXE：请先运行 npx tsx scripts/verify-net-ipv6-demo.ts 编译出 exe'; exit 2 }

# 清场：残留实例按镜像名结束
Get-Process 'net-ipv6-demo' -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep -Milliseconds 600

# ---- 回声服务（runspace 常驻，脚本进程退出时一并终止）----
$tcpPs = [powershell]::Create()
[void]$tcpPs.AddScript({
    $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Parse('::1'), 9001)
    $listener.Start()
    while ($true) {
        $client = $listener.AcceptTcpClient()
        $stream = $client.GetStream()
        $buf = New-Object byte[] 4096
        try {
            while (($n = $stream.Read($buf, 0, $buf.Length)) -gt 0) { $stream.Write($buf, 0, $n); $stream.Flush() }
        } catch { }
        try { $client.Close() } catch { }
    }
})
[void]$tcpPs.BeginInvoke()

$udpPs = [powershell]::Create()
[void]$udpPs.AddScript({
    $udp = New-Object System.Net.Sockets.UdpClient (9001, [System.Net.Sockets.AddressFamily]::InterNetworkV6)
    $remote = New-Object System.Net.IPEndPoint ([System.Net.IPAddress]::IPv6Any, 0)
    while ($true) {
        $data = $udp.Receive([ref]$remote)
        [void]$udp.Send($data, $data.Length, $remote)
    }
})
[void]$udpPs.BeginInvoke()

# ---- Win32 自动化 ----
Add-Type -TypeDefinition @"
using System;
using System.Text;
using System.Runtime.InteropServices;
public class W32Shot {
    [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT r);
    [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr hWnd, IntPtr hdc, uint flags);
    public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
}
public class W32Net {
    public delegate bool EnumProc(IntPtr hWnd, IntPtr lParam);
    [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr lParam);
    [DllImport("user32.dll")] public static extern bool EnumChildWindows(IntPtr parent, EnumProc cb, IntPtr lParam);
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowTextW(IntPtr hWnd, StringBuilder text, int max);
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassNameW(IntPtr hWnd, StringBuilder text, int max);
    [DllImport("user32.dll", EntryPoint="SendMessageW", CharSet=CharSet.Unicode)] public static extern IntPtr SendSetText(IntPtr hWnd, uint msg, IntPtr wp, string lp);
    [DllImport("user32.dll", EntryPoint="SendMessageW")] public static extern IntPtr SendMsg(IntPtr hWnd, uint msg, IntPtr wp, IntPtr lp);
    [DllImport("user32.dll", EntryPoint="PostMessageW")] public static extern bool PostMsg(IntPtr hWnd, uint msg, IntPtr wp, IntPtr lp);
}
"@
Add-Type -AssemblyName System.Drawing
[void][W32Shot]::SetProcessDPIAware()

$script:Results = New-Object System.Collections.ArrayList
function Record([string]$name, [bool]$ok) { [void]$script:Results.Add(($name + '|' + $(if ($ok) { 'PASS' } else { 'FAIL' }))) }
function GWT([IntPtr]$h) {
    $sb = New-Object System.Text.StringBuilder 2048
    [void][W32Net]::GetWindowTextW($h, $sb, 2048)
    return $sb.ToString()
}
function Save-Shot([IntPtr]$h, [string]$name) {
    $r = New-Object W32Shot+RECT
    [void][W32Shot]::GetWindowRect($h, [ref]$r)
    $w = $r.Right - $r.Left; $ht = $r.Bottom - $r.Top
    if (($w -le 0) -or ($ht -le 0)) { return $false }
    $bmp = New-Object System.Drawing.Bitmap ($w, $ht)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $hdc = $g.GetHdc()
    [void][W32Shot]::PrintWindow($h, $hdc, 2)
    $g.ReleaseHdc($hdc); $g.Dispose()
    $bmp.Save((Join-Path $outDir $name), [System.Drawing.Imaging.ImageFormat]::Png)
    $bmp.Dispose()
    return $true
}
$BM_CLICK = 0x00F5; $WM_SETTEXT = 0x000C

# 启动 exe
$proc = Start-Process -FilePath $exe -WorkingDirectory (Split-Path $exe -Parent) -PassThru
$TargetPid = $proc.Id
Start-Sleep -Milliseconds 3000

function Get-WindowPid([IntPtr]$h) {
    $wpid = [System.UInt32]0
    [void][W32Net]::GetWindowThreadProcessId($h, [ref]$wpid)
    return [int]$wpid
}
$script:MainHwnd = [IntPtr]::Zero
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
foreach ($w in $found) { if (($w.Class -ne '#32770') -and ($w.Title.Length -gt 0)) { $script:MainHwnd = $w.Hwnd; break } }
Record 'main-window' ($script:MainHwnd -ne [IntPtr]::Zero)
if ($script:MainHwnd -eq [IntPtr]::Zero) { $script:Results | ForEach-Object { Write-Output ('RESULT|' + $_) }; Stop-Process -Id $TargetPid -Force; exit 1 }
Start-Sleep -Milliseconds 1200

$script:Buttons = @{}
$script:Edits = New-Object System.Collections.ArrayList
$script:TcpLabel = [IntPtr]::Zero
$script:UdpLabel = [IntPtr]::Zero
$ccb = [W32Net+EnumProc]{ param([IntPtr]$h, [IntPtr]$l)
    $c = New-Object System.Text.StringBuilder 128
    [void][W32Net]::GetClassNameW($h, $c, 128)
    $cls = $c.ToString()
    $text = GWT $h
    if ($cls -eq 'Button') { $script:Buttons[$text] = $h }
    elseif ($cls -eq 'Edit') { [void]$script:Edits.Add(@{ Hwnd = $h; Text = $text }) }
    elseif ($cls -eq 'Static') {
        if ($text -eq 'TCP：未连接') { $script:TcpLabel = $h }
        elseif ($text -eq 'UDP：未绑定') { $script:UdpLabel = $h }
    }
    return $true
}
[void][W32Net]::EnumChildWindows($script:MainHwnd, $ccb, [IntPtr]::Zero)
Record 'controls-found' (($script:Buttons.Count -ge 8) -and ($script:Edits.Count -ge 8) -and ($script:TcpLabel -ne [IntPtr]::Zero) -and ($script:UdpLabel -ne [IntPtr]::Zero))

function Wait-Label([IntPtr]$label, [string]$needle, [int]$seconds) {
    $deadline = [DateTime]::UtcNow.AddSeconds($seconds)
    while ([DateTime]::UtcNow -lt $deadline) {
        if (($label -ne [IntPtr]::Zero) -and (GWT $label).Contains($needle)) { return $true }
        Start-Sleep -Milliseconds 150
    }
    return $false
}
# 等待本进程提示框（系统 MessageBox，文本跨进程可读），抓图后点「确定」关闭，返回是否出现。
function Wait-DialogShot([string]$pngName, [int]$seconds) {
    $deadline = [DateTime]::UtcNow.AddSeconds($seconds)
    while ([DateTime]::UtcNow -lt $deadline) {
        $dialogs = New-Object System.Collections.ArrayList
        $cb2 = [W32Net+EnumProc]{ param([IntPtr]$h, [IntPtr]$l)
            $c = New-Object System.Text.StringBuilder 64
            [void][W32Net]::GetClassNameW($h, $c, 64)
            if (($c.ToString() -eq '#32770') -and [W32Net]::IsWindowVisible($h) -and ((Get-WindowPid $h) -eq $TargetPid)) { [void]$dialogs.Add($h) }
            return $true
        }
        [void][W32Net]::EnumWindows($cb2, [IntPtr]::Zero)
        if ($dialogs.Count -gt 0) {
            Start-Sleep -Milliseconds 250   # 等提示框完全绘制
            $shotOk = Save-Shot $dialogs[0] $pngName
            $btns = New-Object System.Collections.ArrayList
            $bcb = [W32Net+EnumProc]{ param([IntPtr]$h, [IntPtr]$l)
                $c = New-Object System.Text.StringBuilder 64
                [void][W32Net]::GetClassNameW($h, $c, 64)
                if ($c.ToString() -eq 'Button') { [void]$btns.Add($h) }
                return $true
            }
            [void][W32Net]::EnumChildWindows($dialogs[0], $bcb, [IntPtr]::Zero)
            if ($btns.Count -gt 0) { [void][W32Net]::SendMsg($btns[0], $BM_CLICK, [IntPtr]::Zero, [IntPtr]::Zero) }
            Start-Sleep -Milliseconds 300
            return $shotOk
        }
        Start-Sleep -Milliseconds 120
    }
    return $false
}
function Click-Button([string]$name) {
    if (-not $script:Buttons.ContainsKey($name)) { throw ('button not found: ' + $name) }
    [void][W32Net]::PostMsg($script:Buttons[$name], $BM_CLICK, [IntPtr]::Zero, [IntPtr]::Zero)
}
function Set-EditByNeedle([string]$needle, [string]$value) {
    foreach ($e in $script:Edits) { if ($e.Text.Contains($needle)) { [void][W32Net]::SendSetText($e.Hwnd, $WM_SETTEXT, [IntPtr]::Zero, $value); return } }
    throw ('edit not found: ' + $needle)
}

# ---- 截图序列 ----
[void](Save-Shot $script:MainHwnd '01-初始界面.png')

# 1) TCP 连接成功：状态标签先变、提示框随后弹出
Click-Button '连接'
$okLabel = Wait-Label $script:TcpLabel 'TCP：已连接' 8
$okDlg = Wait-DialogShot '02-TCP连接成功提示框.png' 6
Start-Sleep -Milliseconds 400
$okMain = Save-Shot $script:MainHwnd '03-TCP连接成功.png'
Record 'tcp-connect-success' ($okLabel -and $okDlg -and $okMain)

# 2) TCP 发送 → 接收回声
Set-EditByNeedle 'TCP 发送' 'IPv6截图验收TCP消息'
Click-Button '发送数据'
$okSend = Wait-Label $script:TcpLabel 'TCP：已发送' 6
Click-Button '接收数据'
$okRecv = Wait-Label $script:TcpLabel 'TCP：已收到数据' 8
Start-Sleep -Milliseconds 300
$okShot = Save-Shot $script:MainHwnd '04-TCP发送并接收成功.png'
Record 'tcp-send-recv' ($okSend -and $okRecv -and $okShot)

# 3) UDP 绑定成功（无弹窗，状态标签+日志为证）
Click-Button '绑定端口'
$okBind = Wait-Label $script:UdpLabel 'UDP：已绑定端口' 6
Start-Sleep -Milliseconds 300
$okShot2 = Save-Shot $script:MainHwnd '05-UDP绑定成功.png'
Record 'udp-bind' ($okBind -and $okShot2)

# 4) UDP 发送 → 接收回声
Set-EditByNeedle 'UDP 你好' 'UDPv6截图验收消息'
Click-Button '发送数据报'
$okUdpSend = Wait-Label $script:UdpLabel 'UDP：已发送数据报' 6
Click-Button '接收数据报'
$okUdpRecv = Wait-Label $script:UdpLabel 'UDP：已收到数据报' 8
Start-Sleep -Milliseconds 300
$okShot3 = Save-Shot $script:MainHwnd '06-UDP发送并接收成功.png'
Record 'udp-send-recv' ($okUdpSend -and $okUdpRecv -and $okShot3)

Stop-Process -Id $TargetPid -Force -ErrorAction SilentlyContinue
Start-Sleep -Milliseconds 400

$script:Results | ForEach-Object { Write-Output ('RESULT|' + $_) }
Get-ChildItem $outDir -Filter '*.png' | ForEach-Object { Write-Output ('FILE|' + $_.Name + '|' + $_.Length) }
$failed = @($script:Results | Where-Object { $_.EndsWith('|FAIL') })
if ($failed.Count -gt 0) { exit 1 } else { exit 0 }
