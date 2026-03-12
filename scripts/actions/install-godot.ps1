param(
  [Parameter(Mandatory = $true)]
  [string]$Version,
  [string]$InstallDir = (Join-Path $PWD ".tools/godot")
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$runnerOs = if ($env:RUNNER_OS) {
  $env:RUNNER_OS
} elseif ($IsWindows) {
  "Windows"
} elseif ($IsLinux) {
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

Write-Host "Downloading $downloadUri"
Invoke-WebRequest -Uri $downloadUri -OutFile $archivePath
Expand-Archive -LiteralPath $archivePath -DestinationPath $InstallDir -Force
Remove-Item -LiteralPath $archivePath -Force

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
