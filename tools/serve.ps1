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
  '.webp' = 'image/webp'
}

# ---------- Save endpoint for tools pages ----------
# PUT /__save/<relative path>   body = the file's bytes
# Lets a page under tools/ (the texture lab, docs/22) write its output into the repo.
# A request is refused (4xx with a small JSON error) unless ALL of these hold:
#   - the method is PUT and the request comes from this computer (127.0.0.1 or ::1),
#   - the Origin header, when present, is this server's own origin (another website
#     open in the browser cannot write files),
#   - the path uses only letters, digits, '.', '_', '-' and '/', and after normalizing
#     it stays inside <repo>/assets/textures/ground/ or is exactly <repo>/assets/textures/CREDITS.md,
#   - the extension is .webp or .md,
#   - the body is under 8 MB.
# Folders are created as needed and an existing file is replaced.
# Success answers 200 {"ok":true,"path":"assets/...","bytes":N}.
$saveMaxBytes = 8 * 1024 * 1024
$saveExts = @('.webp', '.md')

function Send-Json($res, [int]$status, [string]$body) {
  $bytes = [System.Text.Encoding]::UTF8.GetBytes($body)
  $res.StatusCode = $status
  $res.ContentType = 'application/json; charset=utf-8'
  $res.ContentLength64 = $bytes.Length
  $res.OutputStream.Write($bytes, 0, $bytes.Length)
}

function Invoke-Save($ctx, [string]$path) {
  $req = $ctx.Request
  $res = $ctx.Response
  if ($req.HttpMethod -ne 'PUT') { $res.Headers.Add('Allow', 'PUT'); Send-Json $res 405 '{"ok":false,"error":"use PUT"}'; return }
  if (-not [System.Net.IPAddress]::IsLoopback($req.RemoteEndPoint.Address)) { Send-Json $res 403 '{"ok":false,"error":"only from this computer"}'; return }
  $origin = $req.Headers['Origin']
  if ($origin) {
    $own = @("http://localhost:$port", "http://127.0.0.1:$port", "http://[::1]:$port")
    if ($own -notcontains $origin.TrimEnd('/').ToLowerInvariant()) { Send-Json $res 403 '{"ok":false,"error":"origin not allowed"}'; return }
  }
  $rel = $path.Substring('/__save/'.Length)
  if ($rel -notmatch '^[A-Za-z0-9._/-]+$') { Send-Json $res 400 '{"ok":false,"error":"bad characters in path"}'; return }
  $full = [System.IO.Path]::GetFullPath((Join-Path $root $rel.Replace('/', '\')))
  $groundDir = [System.IO.Path]::GetFullPath((Join-Path $root 'assets\textures\ground')).TrimEnd('\') + '\'
  $credits = [System.IO.Path]::GetFullPath((Join-Path $root 'assets\textures\CREDITS.md'))
  $allowed = $full.StartsWith($groundDir, [System.StringComparison]::OrdinalIgnoreCase) -or
    $full.Equals($credits, [System.StringComparison]::OrdinalIgnoreCase)
  if (-not $allowed) { Send-Json $res 403 '{"ok":false,"error":"path outside assets/textures/ground"}'; return }
  $ext = [System.IO.Path]::GetExtension($full).ToLowerInvariant()
  if ($saveExts -notcontains $ext) { Send-Json $res 415 '{"ok":false,"error":"only .webp or .md"}'; return }
  if ($req.ContentLength64 -ge $saveMaxBytes) { Send-Json $res 413 '{"ok":false,"error":"body is 8 MB or more"}'; return }
  # Read the body with a hard cap (also covers chunked uploads with no length).
  $mem = New-Object System.IO.MemoryStream
  $buf = New-Object byte[] 65536
  while (($n = $req.InputStream.Read($buf, 0, $buf.Length)) -gt 0) {
    $mem.Write($buf, 0, $n)
    if ($mem.Length -ge $saveMaxBytes) { Send-Json $res 413 '{"ok":false,"error":"body is 8 MB or more"}'; return }
  }
  if ($mem.Length -eq 0) { Send-Json $res 400 '{"ok":false,"error":"empty body"}'; return }
  [void][System.IO.Directory]::CreateDirectory([System.IO.Path]::GetDirectoryName($full))
  [System.IO.File]::WriteAllBytes($full, $mem.ToArray())
  $relOut = $full.Substring($rootFull.Length).Replace('\', '/')
  Write-Host "  saved $relOut ($($mem.Length) bytes)"
  Send-Json $res 200 ('{"ok":true,"path":"' + $relOut + '","bytes":' + $mem.Length + '}')
}

# ---------- ambientCG fetch for the texture lab ----------
# GET /__fetch/ambientcg?file=<Name>_1K-JPG.zip
# ambientCG does not allow pages on other sites to download its zips directly, so the texture lab
# asks this server, which fetches the zip from https://ambientcg.com/get and passes it back.
# Refused unless: GET, from this computer, Origin (when present) is this server, and the file name
# is a plain ambientCG 1K or 2K JPG zip. At most 40 MB. Only ambientcg.com is ever contacted.
$fetchMaxBytes = 40 * 1024 * 1024

function Invoke-AmbientFetch($ctx) {
  $req = $ctx.Request
  $res = $ctx.Response
  if ($req.HttpMethod -ne 'GET') { $res.Headers.Add('Allow', 'GET'); Send-Json $res 405 '{"ok":false,"error":"use GET"}'; return }
  if (-not [System.Net.IPAddress]::IsLoopback($req.RemoteEndPoint.Address)) { Send-Json $res 403 '{"ok":false,"error":"only from this computer"}'; return }
  $origin = $req.Headers['Origin']
  if ($origin) {
    $own = @("http://localhost:$port", "http://127.0.0.1:$port", "http://[::1]:$port")
    if ($own -notcontains $origin.TrimEnd('/').ToLowerInvariant()) { Send-Json $res 403 '{"ok":false,"error":"origin not allowed"}'; return }
  }
  $file = $req.QueryString['file']
  if (-not $file -or $file -notmatch '^[A-Za-z0-9]+_[12]K-JPG\.zip$') { Send-Json $res 400 '{"ok":false,"error":"file must look like Name_1K-JPG.zip"}'; return }
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
  $web = New-Object System.Net.WebClient
  $web.Headers.Add('User-Agent', 'ebb-texture-lab')
  $bytes = $web.DownloadData("https://ambientcg.com/get?file=$file")
  if ($bytes.Length -ge $fetchMaxBytes) { Send-Json $res 413 '{"ok":false,"error":"zip is 40 MB or more"}'; return }
  Write-Host "  fetched $file from ambientcg.com ($($bytes.Length) bytes)"
  $res.ContentType = 'application/zip'
  $res.ContentLength64 = $bytes.Length
  $res.OutputStream.Write($bytes, 0, $bytes.Length)
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

    if ($path.StartsWith('/__save/')) {
      try { Invoke-Save $ctx $path } catch { try { Send-Json $res 500 '{"ok":false,"error":"could not write the file"}' } catch {} }
      continue
    }
    if ($path -eq '/__fetch/ambientcg') {
      try { Invoke-AmbientFetch $ctx } catch { try { Send-Json $res 502 '{"ok":false,"error":"could not reach ambientcg.com"}' } catch {} }
      continue
    }

    # GET /__list/tools or /__list/docs/progress: that folder's file names as JSON, for the test
    # page's check of its test list and for tools/progress.html. No other folder is listed.
    if ($path.StartsWith('/__list/')) {
      $which = $path.Substring('/__list/'.Length).TrimEnd('/')
      if (@('tools', 'docs/progress') -notcontains $which) { Send-Json $res 404 '{"ok":false,"error":"not a listed folder"}'; continue }
      $dir = Join-Path $root $which.Replace('/', '\')
      $names = @()
      if (Test-Path -LiteralPath $dir -PathType Container) { $names = @(Get-ChildItem -LiteralPath $dir -File | ForEach-Object { $_.Name }) }
      Send-Json $res 200 (ConvertTo-Json -InputObject $names -Compress)
      continue
    }

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
