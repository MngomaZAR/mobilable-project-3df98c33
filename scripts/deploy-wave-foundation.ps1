param(
  [string]$ProjectRef = "mobilable-project-3df98c33"
)

$ErrorActionPreference = "Stop"
$supabase = ".\\node_modules\\.bin\\supabase.cmd"

& $supabase db push --linked --include-all

$functions = @(
  "dispatch-create",
  "dispatch-respond",
  "dispatch-state",
  "eta",
  "status-leaderboard",
  "compliance-consent",
  "for-you-ranking",
  "heatmap"
)

foreach ($fn in $functions) {
  & $supabase functions deploy $fn --project-ref $ProjectRef
}

Write-Host "Deployment complete." -ForegroundColor Green
