$ErrorActionPreference = 'Stop'
$rootDir = 'C:\laragon\www\CMS'
$stagingDir = "$rootDir\scratch\deploy_staging"
$zipFile = "$rootDir\cms_infinityfree_deploy.zip"

Write-Host "Creating staging directory: $stagingDir"
if (Test-Path $stagingDir) {
    Remove-Item $stagingDir -Recurse -Force
}
New-Item -ItemType Directory -Path $stagingDir | Out-Null

Write-Host "Copying assets, backend, frontend..."
Copy-Item -Path "$rootDir\assets" -Destination $stagingDir -Recurse
Copy-Item -Path "$rootDir\backend" -Destination $stagingDir -Recurse
Copy-Item -Path "$rootDir\frontend" -Destination $stagingDir -Recurse

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

Write-Host "Deployment package created successfully:"
Get-Item $zipFile | Select-Object Name, Length, LastWriteTime

Write-Host "Cleaning up staging directory..."
Remove-Item $stagingDir -Recurse -Force
Write-Host "Done!"
