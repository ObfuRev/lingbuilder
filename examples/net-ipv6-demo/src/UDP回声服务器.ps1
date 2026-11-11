# UDP IPv6 回声服务器（配套「TCP与UDP IPv6通信演示」示例使用）
# 监听 [::]:9001，把收到的每条数据报原样发回来源地址，并打印在本窗口。
# 运行方式：右键本文件 - 「使用 PowerShell 运行」；或在本目录执行：
#   powershell -ExecutionPolicy Bypass -File .\UDP回声服务器.ps1
$udp = New-Object System.Net.Sockets.UdpClient(9001, [System.Net.Sockets.AddressFamily]::InterNetworkV6)
$remote = New-Object System.Net.IPEndPoint([System.Net.IPAddress]::IPv6Any, 0)
Write-Host 'UDP IPv6 回声服务器已启动：[::]:9001（关闭本窗口或 Ctrl+C 退出）'
Write-Host '等待演示程序发送数据报...'
while ($true) {
    $data = $udp.Receive([ref]$remote)
    $text = [System.Text.Encoding]::UTF8.GetString($data)
    Write-Host ('收到来自 ' + $remote.Address.ToString() + ':' + $remote.Port + ' 的数据: ' + $text)
    $udp.Send($data, $data.Length, $remote) | Out-Null
}
