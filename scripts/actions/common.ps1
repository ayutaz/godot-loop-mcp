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
