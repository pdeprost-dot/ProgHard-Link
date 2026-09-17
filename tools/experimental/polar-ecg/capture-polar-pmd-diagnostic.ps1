param(
  [string]$PortName = 'COM8',
  [int]$BaudRate = 115200,
  [double]$CaptureSeconds = 8.0,
  [string]$OutputPath = 'polar_pmd_raw_capture.txt'
)

$ErrorActionPreference = 'Stop'
$port = [System.IO.Ports.SerialPort]::new($PortName, $BaudRate, 'None', 8, 'One')
$port.DtrEnable = $false
$port.RtsEnable = $false

try {
  $port.Open()
  $port.DtrEnable = $true
  Start-Sleep -Milliseconds 100
  $port.DtrEnable = $false
  Start-Sleep -Milliseconds 400
  $startup = [System.Text.StringBuilder]::new()
  $ready = $false
  $wait = [System.Diagnostics.Stopwatch]::StartNew()
  while ($wait.Elapsed.TotalSeconds -lt 90) {
    $chunk = $port.ReadExisting()
    if ($chunk.Length) {
      [void]$startup.Append($chunk)
      $text = $startup.ToString()
      if ($text.Contains('ECG stream started @ 130 Hz') -or $text.Contains('ECG=')) {
        $ready = $true
        break
      }
    }
    Start-Sleep -Milliseconds 20
  }
  if (-not $ready) {
    $preview = $startup.ToString()
    if ($preview.Length -gt 4000) { $preview = $preview.Substring($preview.Length - 4000) }
    throw "ECG stream did not become active within 90 seconds. Log tail:`n$preview"
  }

  $port.Write('x')
  Start-Sleep -Milliseconds 200
  $port.DiscardInBuffer()
  $raw = [System.Text.StringBuilder]::new()
  $clock = [System.Diagnostics.Stopwatch]::StartNew()
  while ($clock.Elapsed.TotalSeconds -lt $CaptureSeconds) {
    $chunk = $port.ReadExisting()
    if ($chunk.Length) { [void]$raw.Append($chunk) } else { Start-Sleep -Milliseconds 2 }
  }
  $tail = $port.ReadExisting()
  if ($tail.Length) { [void]$raw.Append($tail) }
  [System.IO.File]::WriteAllText((Join-Path (Get-Location) $OutputPath), $raw.ToString(),
    [System.Text.UTF8Encoding]::new($false))
  $packetCount = ([regex]::Matches($raw.ToString(), '(?m)^PMD_RAW ')).Count
  [pscustomobject]@{ Ready = $ready; Seconds = $clock.Elapsed.TotalSeconds; Packets = $packetCount; Output = $OutputPath }
}
finally {
  if ($port.IsOpen) { $port.Close() }
  $port.Dispose()
}
