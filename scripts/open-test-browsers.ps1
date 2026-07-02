param(
  [string]$Url = "http://localhost:3000",
  [int]$Players = 4
)

$chromeCandidates = @(
  "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
  "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
  "$env:LocalAppData\Google\Chrome\Application\chrome.exe",
  "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe",
  "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe"
)

$browser = $chromeCandidates | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $browser) {
  Write-Error "No Chrome or Edge executable was found."
  exit 1
}

for ($index = 1; $index -le $Players; $index++) {
  $profileDir = Join-Path $env:TEMP "open-clocktower-player-$index"
  New-Item -ItemType Directory -Force -Path $profileDir | Out-Null
  Start-Process -FilePath $browser -ArgumentList @(
    "--incognito",
    "--new-window",
    "--user-data-dir=$profileDir",
    $Url
  )
}
