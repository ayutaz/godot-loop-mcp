param(
  [Parameter(Mandatory = $true)]
  [string]$Version,
  [string]$InstallDir = (Join-Path $PWD ".tools/godot")
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Invoke-DownloadWithRetry {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Uri,
    [Parameter(Mandatory = $true)]
    [string]$OutFile,
    [int]$MaxAttempts = 3
  )

  for ($attempt = 1; $attempt -le $MaxAttempts; $attempt++) {
    try {
      Invoke-WebRequest -Uri $Uri -OutFile $OutFile
      return
    }
    catch {
      if ($attempt -eq $MaxAttempts) {
        throw
      }

      $delaySeconds = [Math]::Pow(2, $attempt)
      Write-Warning "Download failed for $Uri (attempt $attempt/$MaxAttempts). Retrying in $delaySeconds seconds."
      Start-Sleep -Seconds $delaySeconds
    }
  }
}

function Get-GodotReleaseAssetMap {
  param(
    [Parameter(Mandatory = $true)]
    [string]$ReleaseTag
  )

  $headers = @{
    "User-Agent" = "godot-loop-mcp-ci"
    "Accept" = "application/vnd.github+json"
  }

  if (-not [string]::IsNullOrWhiteSpace($env:GITHUB_TOKEN)) {
    $headers["Authorization"] = "Bearer $($env:GITHUB_TOKEN)"
  }

  $release = Invoke-RestMethod `
    -Uri "https://api.github.com/repos/godotengine/godot-builds/releases/tags/$ReleaseTag" `
    -Headers $headers

  $assetMap = @{}
  foreach ($asset in $release.assets) {
    $assetMap[$asset.name] = $asset
  }

  return $assetMap
}

function Get-ExpectedSha512 {
  param(
    [Parameter(Mandatory = $true)]
    [string]$ChecksumFilePath,
    [Parameter(Mandatory = $true)]
    [string]$ArchiveName
  )

  $checksumLine = Get-Content -LiteralPath $ChecksumFilePath | Where-Object {
    $_ -match ("  " + [regex]::Escape($ArchiveName) + "$")
  } | Select-Object -First 1

  if ([string]::IsNullOrWhiteSpace($checksumLine)) {
    throw "Failed to locate SHA512 entry for '$ArchiveName' in '$ChecksumFilePath'."
  }

  return ($checksumLine -split '\s+', 2)[0].Trim().ToLowerInvariant()
}

$platformIsWindows = [System.Runtime.InteropServices.RuntimeInformation]::IsOSPlatform([System.Runtime.InteropServices.OSPlatform]::Windows)
$platformIsLinux = [System.Runtime.InteropServices.RuntimeInformation]::IsOSPlatform([System.Runtime.InteropServices.OSPlatform]::Linux)

$runnerOs = if ($env:RUNNER_OS) {
  $env:RUNNER_OS
} elseif ($platformIsWindows) {
  "Windows"
} elseif ($platformIsLinux) {
  "Linux"
} else {
  [System.Runtime.InteropServices.RuntimeInformation]::OSDescription
}

switch -Wildcard ($runnerOs) {
  "Windows*" {
    $archiveName = "Godot_v${Version}_win64.exe.zip"
    $binaryName = "Godot_v${Version}_win64.exe"
  }
  "Linux*" {
    $archiveName = "Godot_v${Version}_linux.x86_64.zip"
    $binaryName = "Godot_v${Version}_linux.x86_64"
  }
  default {
    throw "Unsupported runner OS '$runnerOs'."
  }
}

$downloadUri = "https://github.com/godotengine/godot-builds/releases/download/$Version/$archiveName"
New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
$archivePath = Join-Path $InstallDir $archiveName
$checksumPath = Join-Path $InstallDir "SHA512-SUMS.txt"

$assetMap = Get-GodotReleaseAssetMap -ReleaseTag $Version
$archiveAsset = $assetMap[$archiveName]
if ($null -eq $archiveAsset) {
  throw "Release '$Version' does not contain asset '$archiveName'."
}

$checksumAsset = $assetMap["SHA512-SUMS.txt"]
if ($null -eq $checksumAsset) {
  throw "Release '$Version' does not contain SHA512-SUMS.txt."
}

Write-Host "Downloading $downloadUri"
Invoke-DownloadWithRetry -Uri $downloadUri -OutFile $archivePath
Invoke-DownloadWithRetry -Uri $checksumAsset.browser_download_url -OutFile $checksumPath

$expectedSha512 = Get-ExpectedSha512 -ChecksumFilePath $checksumPath -ArchiveName $archiveName
$actualSha512 = (Get-FileHash -LiteralPath $archivePath -Algorithm SHA512).Hash.ToLowerInvariant()
if ($actualSha512 -ne $expectedSha512) {
  throw "SHA512 mismatch for '$archiveName'. expected='$expectedSha512' actual='$actualSha512'"
}

Expand-Archive -LiteralPath $archivePath -DestinationPath $InstallDir -Force
Remove-Item -LiteralPath $archivePath -Force
Remove-Item -LiteralPath $checksumPath -Force

$binary = Get-ChildItem -Path $InstallDir -Recurse -File | Where-Object { $_.Name -eq $binaryName } | Select-Object -First 1
if (-not $binary) {
  throw "Failed to locate extracted Godot binary '$binaryName'."
}

if ($runnerOs -like "Linux*") {
  & chmod +x $binary.FullName
}

if ($env:GITHUB_OUTPUT) {
  "binary_path=$($binary.FullName)" | Out-File -FilePath $env:GITHUB_OUTPUT -Encoding utf8 -Append
}

Write-Host "Godot installed: $($binary.FullName)"
