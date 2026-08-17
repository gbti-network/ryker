[CmdletBinding(SupportsShouldProcess)]
param(
    [string]$Destination = 'C:\Users\Hudson Atwell\Desktop\Codeable\Partner Ops\WooCommerce\Placement Audits\reports\ryker',
    [switch]$SkipBuild,
    [switch]$SkipReportBuild
)

$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
$source = Join-Path $repoRoot 'drop-in'
$managedFiles = @('README.md')
$managedDirectories = @('build', 'dist', 'docs', 'src')
$sourceSentinels = @(
    'README.md',
    'build\bundle.mjs',
    'dist\ryker.js',
    'src\bootstrap\boot.js'
)

function Assert-ChildPath {
    param(
        [Parameter(Mandatory)] [string]$Parent,
        [Parameter(Mandatory)] [string]$Child
    )

    $parentPrefix = $Parent.TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
    if (-not $Child.StartsWith($parentPrefix, [StringComparison]::OrdinalIgnoreCase)) {
        throw "Refusing to operate outside the mirror: $Child"
    }
}

if (-not (Test-Path -LiteralPath $source -PathType Container)) {
    throw "Ryker drop-in source was not found: $source"
}

foreach ($sentinel in $sourceSentinels) {
    if (-not (Test-Path -LiteralPath (Join-Path $source $sentinel) -PathType Leaf)) {
        throw "The source is missing the expected Ryker file: $sentinel"
    }
}

if (-not (Test-Path -LiteralPath $Destination -PathType Container)) {
    throw "The deployment mirror must already exist: $Destination"
}

$destinationPath = (Resolve-Path -LiteralPath $Destination).Path
if ((Split-Path -Leaf $destinationPath) -ne 'ryker' -or (Split-Path -Leaf (Split-Path -Parent $destinationPath)) -ne 'reports') {
    throw "The destination must be the dedicated reports\ryker directory: $destinationPath"
}

foreach ($sentinel in @('README.md', 'src', 'dist')) {
    if (-not (Test-Path -LiteralPath (Join-Path $destinationPath $sentinel))) {
        throw "The destination does not look like an existing Ryker mirror; missing: $sentinel"
    }
}

if (-not $SkipBuild) {
    & node (Join-Path $source 'build\bundle.mjs')
    if ($LASTEXITCODE -ne 0) {
        throw "Ryker bundle build failed with exit code $LASTEXITCODE"
    }
}

$copied = 0
$removed = 0

foreach ($relativePath in $managedFiles) {
    $sourcePath = Join-Path $source $relativePath
    $targetPath = Join-Path $destinationPath $relativePath
    Assert-ChildPath -Parent $destinationPath -Child $targetPath
    if ($PSCmdlet.ShouldProcess($targetPath, "Copy $relativePath from the repository")) {
        Copy-Item -LiteralPath $sourcePath -Destination $targetPath -Force
        $copied++
    }
}

foreach ($relativeDirectory in $managedDirectories) {
    $sourceDirectory = Join-Path $source $relativeDirectory
    $targetDirectory = Join-Path $destinationPath $relativeDirectory
    Assert-ChildPath -Parent $destinationPath -Child $targetDirectory

    if (-not (Test-Path -LiteralPath $targetDirectory -PathType Container)) {
        if ($PSCmdlet.ShouldProcess($targetDirectory, 'Create managed directory')) {
            New-Item -ItemType Directory -Path $targetDirectory | Out-Null
        }
    }

    $sourceRelativeFiles = @{}
    foreach ($sourceFile in Get-ChildItem -LiteralPath $sourceDirectory -Recurse -File) {
        $relativeFile = $sourceFile.FullName.Substring($sourceDirectory.Length).TrimStart([IO.Path]::DirectorySeparatorChar)
        $sourceRelativeFiles[$relativeFile] = $true
        $targetFile = Join-Path $targetDirectory $relativeFile
        Assert-ChildPath -Parent $destinationPath -Child $targetFile
        $targetParent = Split-Path -Parent $targetFile

        if (-not (Test-Path -LiteralPath $targetParent -PathType Container)) {
            if ($PSCmdlet.ShouldProcess($targetParent, 'Create managed directory')) {
                New-Item -ItemType Directory -Path $targetParent -Force | Out-Null
            }
        }

        if ($PSCmdlet.ShouldProcess($targetFile, "Copy $relativeDirectory\$relativeFile from the repository")) {
            Copy-Item -LiteralPath $sourceFile.FullName -Destination $targetFile -Force
            $copied++
        }
    }

    if (Test-Path -LiteralPath $targetDirectory -PathType Container) {
        foreach ($targetFile in Get-ChildItem -LiteralPath $targetDirectory -Recurse -File) {
            $relativeFile = $targetFile.FullName.Substring($targetDirectory.Length).TrimStart([IO.Path]::DirectorySeparatorChar)
            if (-not $sourceRelativeFiles.ContainsKey($relativeFile)) {
                Assert-ChildPath -Parent $destinationPath -Child $targetFile.FullName
                if ($PSCmdlet.ShouldProcess($targetFile.FullName, 'Remove retired managed file')) {
                    Remove-Item -LiteralPath $targetFile.FullName -Force
                    $removed++
                }
            }
        }

        $directories = @(Get-ChildItem -LiteralPath $targetDirectory -Recurse -Directory | Sort-Object FullName -Descending)
        foreach ($directory in $directories) {
            Assert-ChildPath -Parent $destinationPath -Child $directory.FullName
            if (-not (Get-ChildItem -LiteralPath $directory.FullName -Force)) {
                if ($PSCmdlet.ShouldProcess($directory.FullName, 'Remove empty managed directory')) {
                    Remove-Item -LiteralPath $directory.FullName -Force
                }
            }
        }
    }
}

if (-not $SkipReportBuild -and -not $WhatIfPreference) {
    $auditRoot = Split-Path -Parent (Split-Path -Parent $destinationPath)
    $reportBuilder = Join-Path $auditRoot '.data\build\build-reports.sh'
    if (Test-Path -LiteralPath $reportBuilder -PathType Leaf) {
        $wslBuilder = (& wsl.exe -d Ubuntu -- wslpath -a (Convert-Path -LiteralPath $reportBuilder)).Trim()
        & wsl.exe -d Ubuntu -- bash $wslBuilder
        if ($LASTEXITCODE -ne 0) {
            throw "Placement Audit report build failed with exit code $LASTEXITCODE"
        }
        Write-Host 'Placement Audit report pages rebuilt with the synchronized Ryker bundle.'
    }
}

Write-Host "Ryker mirror synchronized: $copied file(s) copied, $removed retired file(s) removed."
Write-Host "Preserved unmanaged content, including: $destinationPath\revisions"
