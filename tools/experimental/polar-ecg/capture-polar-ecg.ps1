param(
  [string]$PortName = 'COM8',
  [int]$BaudRate = 115200,
  [double]$CaptureSeconds = 15.0,
  [string]$OutputPath = 'polar_ecg_capture.txt'
)

$ErrorActionPreference = 'Stop'
$port = [System.IO.Ports.SerialPort]::new($PortName, $BaudRate, 'None', 8, 'One')
$port.NewLine = "`n"
$port.ReadTimeout = 250
$port.WriteTimeout = 1000
$port.DtrEnable = $false
$port.RtsEnable = $false

try {
  $port.Open()

  # USB CDC reset pulse, without reflashing.
  $port.DtrEnable = $true
  Start-Sleep -Milliseconds 100
  $port.DtrEnable = $false
  Start-Sleep -Milliseconds 400
  $port.DiscardInBuffer()

  $startup = [System.Text.StringBuilder]::new()
  $ready = $false
  $numericRun = 0
  $wait = [System.Diagnostics.Stopwatch]::StartNew()
  while ($wait.Elapsed.TotalSeconds -lt 75) {
    $chunk = $port.ReadExisting()
    if ($chunk.Length -gt 0) {
      [void]$startup.Append($chunk)
      $startupText = $startup.ToString()
      foreach ($line in ($chunk -split "`n")) {
        if ($line -match '^-?\d+\r?$') { $numericRun++ }
      }
      if ($startupText.Contains('ECG stream started @ 130 Hz') -or
          $startupText.Contains('ECG=') -or $numericRun -ge 20) {
        $ready = $true
        break
      }
    }
    Start-Sleep -Milliseconds 20
  }

  if (-not $ready) {
    $preview = $startup.ToString()
    if ($preview.Length -gt 4000) { $preview = $preview.Substring($preview.Length - 4000) }
    throw "Active ECG stream was not observed within 75 seconds. Startup log tail:`n$preview"
  }

  Start-Sleep -Milliseconds 250
  $port.DiscardInBuffer()
  $port.Write('p')
  # Let any diagnostic text already queued before the mode switch drain fully.
  Start-Sleep -Milliseconds 1000
  $port.DiscardInBuffer()

  $capture = [System.Text.StringBuilder]::new()
  $clock = [System.Diagnostics.Stopwatch]::StartNew()
  while ($clock.Elapsed.TotalSeconds -lt $CaptureSeconds) {
    $chunk = $port.ReadExisting()
    if ($chunk.Length -gt 0) {
      [void]$capture.Append($chunk)
    } else {
      Start-Sleep -Milliseconds 2
    }
  }
  $elapsed = $clock.Elapsed.TotalSeconds

  # Drain only bytes already queued at the acquisition boundary.
  $tail = $port.ReadExisting()
  if ($tail.Length -gt 0) { [void]$capture.Append($tail) }

  $raw = $capture.ToString()
  $lastLf = $raw.LastIndexOf("`n")
  if ($lastLf -lt 0) { throw 'No complete serial line was captured.' }
  $complete = $raw.Substring(0, $lastLf + 1)
  [System.IO.File]::WriteAllText((Join-Path (Get-Location) $OutputPath), $complete,
    [System.Text.UTF8Encoding]::new($false))

  $lines = $complete -split "`n" | Where-Object { $_ -ne '' }
  $numeric = @($lines | Where-Object { $_ -match '^-?\d+\r?$' })
  $meta = [ordered]@{
    port = $PortName
    baud = $BaudRate
    requested_seconds = $CaptureSeconds
    wall_clock_seconds = $elapsed
    complete_lines = $lines.Count
    numeric_lines = $numeric.Count
    captured_at = [DateTimeOffset]::Now.ToString('o')
    startup_log = $startup.ToString()
  }
  $meta | ConvertTo-Json -Depth 3 | Set-Content -Encoding utf8 'polar_ecg_capture_meta.json'

  [pscustomobject]@{
    Ready = $ready
    Seconds = [math]::Round($elapsed, 3)
    Lines = $lines.Count
    NumericLines = $numeric.Count
    Output = (Join-Path (Get-Location) $OutputPath)
  }
}
finally {
  if ($port.IsOpen) {
    try { $port.Write('d') } catch {}
    Start-Sleep -Milliseconds 100
    $port.Close()
  }
  $port.Dispose()
}
