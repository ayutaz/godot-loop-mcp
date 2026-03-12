Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Ensure-EmptyDirectory {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Path
  )

  if (Test-Path -LiteralPath $Path) {
    Remove-Item -LiteralPath $Path -Recurse -Force
  }

  New-Item -ItemType Directory -Path $Path -Force | Out-Null
}

function Wait-FileContainsString {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Path,
    [Parameter(Mandatory = $true)]
    [string]$Needle,
    [int]$TimeoutSeconds = 30
  )

  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  while ((Get-Date) -lt $deadline) {
    if (Test-Path -LiteralPath $Path) {
      $content = Get-Content -LiteralPath $Path -Raw -ErrorAction SilentlyContinue
      if ($null -ne $content -and $content.Contains($Needle)) {
        return
      }
    }
    Start-Sleep -Seconds 1
  }

  throw "Timed out waiting for '$Needle' in '$Path'."
}

function Assert-FileContainsString {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Path,
    [Parameter(Mandatory = $true)]
    [string]$Needle
  )

  if (-not (Test-Path -LiteralPath $Path)) {
    throw "Expected file '$Path' to exist."
  }

  $content = Get-Content -LiteralPath $Path -Raw
  if (-not $content.Contains($Needle)) {
    throw "Expected '$Needle' in '$Path'."
  }
}

function Suspend-GodotScanConflicts {
  param(
    [Parameter(Mandatory = $true)]
    [string]$RepoRoot
  )

  $entries = @()
  $distRoot = Join-Path $RepoRoot "dist"
  if (-not (Test-Path -LiteralPath $distRoot)) {
    return [pscustomobject]@{
      QuarantineRoot = $null
      Entries = @()
    }
  }

  $quarantineRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("godot-loop-mcp-scan-shield-" + [guid]::NewGuid().ToString("N"))
  New-Item -ItemType Directory -Path $quarantineRoot -Force | Out-Null

  foreach ($releaseDir in Get-ChildItem -LiteralPath $distRoot -Directory -ErrorAction SilentlyContinue) {
    $stagingPath = Join-Path $releaseDir.FullName "addon-staging"
    if (-not (Test-Path -LiteralPath $stagingPath)) {
      continue
    }

    $quarantinedPath = Join-Path $quarantineRoot ($releaseDir.Name + "-addon-staging")
    Move-Item -LiteralPath $stagingPath -Destination $quarantinedPath
    $entries += [pscustomobject]@{
      OriginalPath = $stagingPath
      QuarantinedPath = $quarantinedPath
    }
  }

  return [pscustomobject]@{
    QuarantineRoot = $quarantineRoot
    Entries = $entries
  }
}

function Resume-GodotScanConflicts {
  param(
    [Parameter(Mandatory = $true)]
    [psobject]$State
  )

  foreach ($entry in $State.Entries) {
    if (-not (Test-Path -LiteralPath $entry.QuarantinedPath)) {
      continue
    }

    $destinationDir = Split-Path -Parent $entry.OriginalPath
    New-Item -ItemType Directory -Path $destinationDir -Force | Out-Null
    Move-Item -LiteralPath $entry.QuarantinedPath -Destination $entry.OriginalPath
  }

  if ($null -ne $State.QuarantineRoot -and (Test-Path -LiteralPath $State.QuarantineRoot)) {
    Remove-Item -LiteralPath $State.QuarantineRoot -Recurse -Force
  }
}
