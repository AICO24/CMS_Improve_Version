$ErrorActionPreference = 'Stop'
$rootDir = 'C:\laragon\www\CMS'
$stagingDir = "$rootDir\scratch\deploy_staging"
$zipFile = "$rootDir\cms_deploy.zip"

Write-Host "Creating clean staging directory: $stagingDir"
if (Test-Path $stagingDir) {
    Remove-Item $stagingDir -Recurse -Force
}
New-Item -ItemType Directory -Path $stagingDir | Out-Null

Write-Host "Copying assets, backend, frontend..."
Copy-Item -Path "$rootDir\assets" -Destination $stagingDir -Recurse
Copy-Item -Path "$rootDir\backend" -Destination $stagingDir -Recurse
Copy-Item -Path "$rootDir\frontend" -Destination $stagingDir -Recurse

Write-Host "Pruning unnecessary heavy assets to ensure zip is under InfinityFree 10MB limit..."
# Remove unneeded ~2MB PNGs (their .jpg versions are already used by frontend and are ~60KB)
$heavyPngs = @('Buenabentura.png', 'Gabayan.png', 'Giray.png', 'Gochaico.png', 'Salas.png')
foreach ($png in $heavyPngs) {
    $pngPath = Join-Path "$stagingDir\assets\images" $png
    if (Test-Path $pngPath) {
        Remove-Item $pngPath -Force
        Write-Host "Pruned $png"
    }
}

# Remove logs
if (Test-Path "$stagingDir\backend\storage\logs") {
    Get-ChildItem -Path "$stagingDir\backend\storage\logs" -Filter "*.log" | Remove-Item -Force
}

Write-Host "Copying root index.php and .htaccess..."
Copy-Item -Path "$rootDir\index.php" -Destination $stagingDir
Copy-Item -Path "$rootDir\.htaccess" -Destination $stagingDir

Write-Host "Configuring .env for InfinityFree..."
Copy-Item -Path "$rootDir\.env.production" -Destination "$stagingDir\.env"

if (Test-Path $zipFile) {
    Write-Host "Removing existing zip..."
    Remove-Item $zipFile -Force
}

Write-Host "Compressing to $zipFile..."
Compress-Archive -Path "$stagingDir\*" -DestinationPath $zipFile -CompressionLevel Optimal

$zipItem = Get-Item $zipFile
$sizeMB = [math]::Round($zipItem.Length / 1MB, 2)
Write-Host "Deployment package created successfully! Size: $sizeMB MB"
$zipItem | Select-Object Name, Length, LastWriteTime

Write-Host "Cleaning up staging directory..."
Remove-Item $stagingDir -Recurse -Force
Write-Host "Done!"
