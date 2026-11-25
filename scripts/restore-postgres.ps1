param(
  [string]$HostName = "127.0.0.1",
  [int]$Port = 5432,
  [string]$User = "postgres",
  [string]$DbName = "toantrung_v2_trial",
  [string]$DumpFile = "toantrung_v2_backup.dump"
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path $DumpFile)) {
  Write-Error "Khong tim thay file backup: $DumpFile"
  exit 1
}

$pgBins = @(
  "C:\Program Files\PostgreSQL\18\bin",
  "C:\Program Files\PostgreSQL\17\bin",
  "C:\Program Files\PostgreSQL\16\bin"
)
$binDir = $pgBins | Where-Object { Test-Path $_ } | Select-Object -First 1

$createdbCmd = if ($binDir) { Join-Path $binDir "createdb.exe" } else { "createdb" }
$restoreCmd = if ($binDir) { Join-Path $binDir "pg_restore.exe" } else { "pg_restore" }

Write-Host "1/2 Kiem tra / tao database $DbName tren $HostName`:$Port..." -ForegroundColor Cyan
try {
  & $createdbCmd -h $HostName -p $Port -U $User $DbName 2>$null
} catch {
  # Database may already exist
}

Write-Host "2/2 Nap du lieu tu $DumpFile vao $DbName..." -ForegroundColor Cyan
& $restoreCmd -h $HostName -p $Port -U $User -d $DbName --clean --if-exists --no-owner --no-acl $DumpFile

Write-Host "Hoan tat nap database $DbName!" -ForegroundColor Green
