# Local web server for ebb, started by play.cmd.
# Serves the repo folder at http://localhost:<port>/ with no caching, so switching
# branches in GitHub Desktop shows the new code on the next refresh.
# Uses only what ships with Windows (PowerShell 5.1 and .NET), nothing to install.

param([switch]$NoBrowser)

$ErrorActionPreference = 'Stop'
$firstPort = 8080
$lastPort = 8099

function Stop-WithMessage([string[]]$lines) {
  Write-Host ''
  foreach ($l in $lines) { Write-Host "  $l" -ForegroundColor Yellow }
  Write-Host ''
  Write-Host '  Press any key to close this window.'
  try { [void][Console]::ReadKey($true) } catch { Start-Sleep -Seconds 30 }
  exit 3
}

function Get-Branch([string]$root) {
  try {
    $head = (Get-Content -LiteralPath (Join-Path $root '.git\HEAD') -TotalCount 1).Trim()
    if ($head -like 'ref: refs/heads/*') { return $head.Substring(16) }
    return 'detached'
  } catch { return 'unknown' }
}

function Test-PortFree([int]$port) {
  $probe = $null
  try {
    $probe = New-Object System.Net.Sockets.TcpListener([System.Net.IPAddress]::Loopback, $port)
    $probe.Start()
    return $true
  } catch { return $false }
  finally { if ($probe) { $probe.Stop() } }
}

$mime = @{
  '.html' = 'text/html; charset=utf-8'; '.htm' = 'text/html; charset=utf-8'
  '.js' = 'text/javascript; charset=utf-8'; '.mjs' = 'text/javascript; charset=utf-8'
  '.css' = 'text/css; charset=utf-8'; '.json' = 'application/json; charset=utf-8'
  '.webmanifest' = 'application/manifest+json; charset=utf-8'
  '.wgsl' = 'text/plain; charset=utf-8'; '.txt' = 'text/plain; charset=utf-8'; '.md' = 'text/plain; charset=utf-8'
  '.svg' = 'image/svg+xml'; '.png' = 'image/png'; '.jpg' = 'image/jpeg'; '.ico' = 'image/x-icon'
  '.woff2' = 'font/woff2'; '.wasm' = 'application/wasm'; '.ogg' = 'audio/ogg'; '.mp3' = 'audio/mpeg'
}

try {
  $root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
} catch {
  Stop-WithMessage @("Couldn't find the ebb files next to play.cmd.", 'play.cmd needs to stay inside the ebb folder.')
}
if (-not (Test-Path -LiteralPath (Join-Path $root 'index.html'))) {
  Stop-WithMessage @("Couldn't find the ebb files next to play.cmd (index.html is missing).",
    'In GitHub Desktop, check that the right branch is selected, then double-click play.cmd again.')
}

# Find a free port and start listening.
$listener = $null
$port = 0
$lastError = ''
for ($p = $firstPort; $p -le $lastPort; $p++) {
  if (-not (Test-PortFree $p)) { continue }
  $candidate = New-Object System.Net.HttpListener
  $candidate.Prefixes.Add("http://localhost:$p/")
  try {
    $candidate.Start()
    $listener = $candidate
    $port = $p
    break
  } catch [System.Net.HttpListenerException] {
    $lastError = $_.Exception.Message
    $code = $_.Exception.ErrorCode
    try { $candidate.Close() } catch {}
    if ($code -eq 5) {
      Stop-WithMessage @('Windows blocked the local server (access denied).',
        'Try double-clicking play.cmd again. If it still happens, restart the computer and try once more.',
        "Details: $lastError")
    }
  }
}
if (-not $listener) {
  Stop-WithMessage @("Another program is using every port from $firstPort to $lastPort.",
    'Close other local servers (or other play.cmd windows) and double-click play.cmd again.')
}

$url = "http://localhost:$port/"
$branch = Get-Branch $root
$Host.UI.RawUI.WindowTitle = "ebb, local, branch $branch, port $port"
Write-Host ''
Write-Host "  ebb is running at $url" -ForegroundColor Green
Write-Host "  Branch: $branch    (switch branches in GitHub Desktop, then refresh the browser)"
Write-Host "  Tools:  ${url}tools/"
Write-Host ''
Write-Host '  Keep this window open while you play. Close it to stop.'
Write-Host ''
if (-not $NoBrowser) { try { Start-Process $url } catch { Write-Host "  Open $url in Chrome or Edge." -ForegroundColor Yellow } }

$rootFull = [System.IO.Path]::GetFullPath($root).TrimEnd('\') + '\'

while ($listener.IsListening) {
  try { $ctx = $listener.GetContext() } catch { break }
  $res = $ctx.Response
  try {
    $res.Headers.Add('Cache-Control', 'no-store, must-revalidate')
    $res.Headers.Add('Pragma', 'no-cache')
    $path = [System.Uri]::UnescapeDataString($ctx.Request.Url.AbsolutePath)

    $isBuildInfo = $path -eq '/__local.json' -or
      ($path -eq '/build.json' -and -not (Test-Path -LiteralPath (Join-Path $root 'build.json')))
    if ($isBuildInfo) {
      $body = '{"local":true,"branch":"' + (Get-Branch $root) + '","port":' + $port + '}'
      $bytes = [System.Text.Encoding]::UTF8.GetBytes($body)
      $res.ContentType = $mime['.json']
      $res.ContentLength64 = $bytes.Length
      $res.OutputStream.Write($bytes, 0, $bytes.Length)
      continue
    }

    $rel = $path.TrimStart('/').Replace('/', '\')
    $full = [System.IO.Path]::GetFullPath((Join-Path $root $rel))
    $inside = ($full + '\').StartsWith($rootFull, [System.StringComparison]::OrdinalIgnoreCase)
    if (-not $inside -or $rel -like '.git*') {
      $res.StatusCode = 404
      continue
    }
    if (Test-Path -LiteralPath $full -PathType Container) {
      if (-not $path.EndsWith('/')) {
        $res.StatusCode = 301
        $res.RedirectLocation = $path + '/'
        continue
      }
      $full = Join-Path $full 'index.html'
    }
    if (-not (Test-Path -LiteralPath $full -PathType Leaf)) {
      $res.StatusCode = 404
      continue
    }
    $ext = [System.IO.Path]::GetExtension($full).ToLowerInvariant()
    $res.ContentType = if ($mime.ContainsKey($ext)) { $mime[$ext] } else { 'application/octet-stream' }
    $bytes = [System.IO.File]::ReadAllBytes($full)
    $res.ContentLength64 = $bytes.Length
    $res.OutputStream.Write($bytes, 0, $bytes.Length)
  } catch {
    # A browser closing a connection early is normal; keep serving.
  } finally {
    try { $res.OutputStream.Close() } catch {}
  }
}
