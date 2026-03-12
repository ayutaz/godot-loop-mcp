param(
  [Parameter(Mandatory = $true)]
  [string]$InputDir,
  [string]$OutputPath = (Join-Path $InputDir "SHA256SUMS.txt")
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$files = @(Get-ChildItem -Path $InputDir -File | Where-Object { $_.Name -ne [System.IO.Path]::GetFileName($OutputPath) } | Sort-Object Name)
if ($files.Count -eq 0) {
  throw "No files found under '$InputDir' to hash."
}

$lines = foreach ($file in $files) {
  $hash = Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256
  "{0}  {1}" -f $hash.Hash.ToLowerInvariant(), $file.Name
}

Set-Content -LiteralPath $OutputPath -Value $lines
