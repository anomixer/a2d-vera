# sync-upstream.ps1
# Keep main in sync with upstream (a2stuff/a2d), then merge into vera-mirror.
# Usage: .\sync-upstream.ps1

$ErrorActionPreference = "Stop"
$branch = "vera-mirror"

Write-Host "==> Fetching upstream..." -ForegroundColor Cyan
git fetch origin

$localMain  = git rev-parse main
$remoteMain = git rev-parse origin/main

if ($localMain -eq $remoteMain) {
    Write-Host "main is already up to date with upstream." -ForegroundColor Green
} else {
    Write-Host "==> Advancing main to origin/main..." -ForegroundColor Cyan
    git branch -f main origin/main
    Write-Host "main advanced: $($localMain.Substring(0,8)) -> $($remoteMain.Substring(0,8))" -ForegroundColor Green
}

$current = git branch --show-current
if ($current -ne $branch) {
    Write-Host "==> Switching to $branch..." -ForegroundColor Cyan
    git checkout $branch
}

$mergeBase = git merge-base $branch main
$mainTip   = git rev-parse main

if ($mergeBase -eq $mainTip) {
    Write-Host "$branch already contains all of main. Nothing to merge." -ForegroundColor Green
} else {
    Write-Host "==> Merging main into $branch..." -ForegroundColor Cyan
    git merge main -m "Merge upstream main into $branch"
    Write-Host "Merge complete." -ForegroundColor Green
}

Write-Host ""
Write-Host "Branch status:" -ForegroundColor Cyan
git log -n 5 --graph --oneline main $branch origin/main
