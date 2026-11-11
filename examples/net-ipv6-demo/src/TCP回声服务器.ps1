# TCP IPv6 回声服务器（配套「TCP与UDP IPv6通信演示」示例使用）
# 监听 [::1]:9001，把收到的每条消息原样发回，并打印在本窗口。
# 运行方式：右键本文件 - 「使用 PowerShell 运行」；或在本目录执行：
#   powershell -ExecutionPolicy Bypass -File .\TCP回声服务器.ps1
$listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Parse('::1'), 9001)
$listener.Start()
Write-Host 'TCP IPv6 回声服务器已启动：[::1]:9001（关闭本窗口或 Ctrl+C 退出）'
Write-Host '等待演示程序连接...'
while ($true) {
    $client = $listener.AcceptTcpClient()
    $stream = $client.GetStream()
    $buffer = New-Object byte[] 4096
    Write-Host ('客户端已连接: ' + $client.Client.RemoteEndPoint.ToString())
    try {
        while (($count = $stream.Read($buffer, 0, $buffer.Length)) -gt 0) {
            $text = [System.Text.Encoding]::UTF8.GetString($buffer, 0, $count)
            Write-Host ('收到: ' + $text)
            $stream.Write($buffer, 0, $count)
            $stream.Flush()
        }
    } catch {
        Write-Host ('连接异常: ' + $_.Exception.Message)
    } finally {
        $client.Close()
        Write-Host '客户端已断开，继续等待下一个连接...'
    }
}
