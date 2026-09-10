Write-Host "== Removing confirmed-dead files ==" -ForegroundColor Cyan

$deadFiles = @(
  "all-code.txt",
  "desktop.zip",
  "tree.txt",
  "vsmart-memory.db",
  "vsmart-memory.db-shm",
  "vsmart-memory.db-wal",
  "src/app/components/layout/BottomBar.txt",
  "src/app/components/layout/BottomBar1.txt",
  "src/agents/browserAgent.ts",
  "src/app/components/TitleBar.tsx",
  "src/app/components/TitleBar.css",
  "src/app/components/orb",
  "src/app/components/widgets",
  "src/app/components/dashboard/useMarketFeed.ts",
  "src/app/hooks/useSystem.ts",
  "src/core/commandEngine.ts",
  "src/core/memory.ts",
  "src/core/memoryManager.ts",
  "src/services/voskService.ts"
)

foreach ($f in $deadFiles) {
  if (Test-Path $f) {
    Remove-Item $f -Recurse -Force
    Write-Host "  removed: $f" -ForegroundColor Green
  } else {
    Write-Host "  already gone: $f" -ForegroundColor DarkGray
  }
}

Write-Host ""
Write-Host "== Patching src/llm/openrouter.ts (process.env fix) ==" -ForegroundColor Cyan

$openrouterPath = "src\llm\openrouter.ts"

if (Test-Path $openrouterPath) {
  $content = Get-Content $openrouterPath -Raw
  $needle = 'process.env.NODE_ENV !== "production"'
  $replacement = 'import.meta.env.MODE !== "production"'

  if ($content -like "*$needle*") {
    $patched = $content.Replace($needle, $replacement)
    Set-Content -Path $openrouterPath -Value $patched -NoNewline
    Write-Host "  patched OK." -ForegroundColor Green
  } else {
    Write-Host "  pattern not found (maybe already patched) - check manually." -ForegroundColor Yellow
  }
} else {
  Write-Host "  openrouter.ts not found at expected path - skipping." -ForegroundColor Yellow
}

Write-Host ""
Write-Host "DONE with the safe automated part." -ForegroundColor Magenta
Write-Host "Now copy these 5 files manually (full content, from the chat) into place:" -ForegroundColor Cyan
Write-Host "  src/ai/tools.ts"
Write-Host "  src/ai/agenticRouter.ts"
Write-Host "  src/core/aiEngine.ts"
Write-Host "  src/agents/factExtractorAgent.ts"
Write-Host "  src/agents/chatAgent.ts"
Write-Host ""
Write-Host "Then run: npm run dev" -ForegroundColor Cyan