# Generate a simple .ico file using .NET
# Creates a 32x32 icon with "C" letter for CurivAI

Add-Type -AssemblyName System.Drawing

$sizes = @(16, 32, 48, 256)
$bitmaps = @()

foreach ($size in $sizes) {
    $bmp = New-Object System.Drawing.Bitmap($size, $size)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = 'AntiAlias'
    $g.TextRenderingHint = 'AntiAliasGridFit'

    # Background gradient-ish: dark blue
    $bg = [System.Drawing.Color]::FromArgb(255, 30, 58, 138)
    $g.Clear($bg)

    # Draw "C" text
    $fontSize = [int]($size * 0.55)
    $font = New-Object System.Drawing.Font("Arial", $fontSize, [System.Drawing.FontStyle]::Bold)
    $brush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::White)
    $sf = New-Object System.Drawing.StringFormat
    $sf.Alignment = 'Center'
    $sf.LineAlignment = 'Center'
    $rect = New-Object System.Drawing.RectangleF(0, 0, $size, $size)
    $g.DrawString("C", $font, $brush, $rect, $sf)

    $g.Dispose()
    $bitmaps += $bmp
}

# Save as ICO using memory stream trick
$iconPath = Join-Path $PSScriptRoot "icon.ico"
$stream = New-Object System.IO.MemoryStream

# ICO header
$writer = New-Object System.IO.BinaryWriter($stream)
$writer.Write([uint16]0)      # Reserved
$writer.Write([uint16]1)      # Type: ICO
$writer.Write([uint16]$sizes.Count)  # Image count

# Write directory entries (placeholder offsets)
$dataOffset = 6 + $sizes.Count * 16
$imageStreams = @()

foreach ($bmp in $bitmaps) {
    $ms = New-Object System.IO.MemoryStream
    $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
    $imageStreams += $ms

    $w = if ($bmp.Width -ge 256) { 0 } else { [byte]$bmp.Width }
    $h = if ($bmp.Height -ge 256) { 0 } else { [byte]$bmp.Height }
    $writer.Write([byte]$w)
    $writer.Write([byte]$h)
    $writer.Write([byte]0)   # Color count
    $writer.Write([byte]0)   # Reserved
    $writer.Write([uint16]1) # Planes
    $writer.Write([uint16]32) # Bit count
    $writer.Write([uint32]$ms.Length)
    $writer.Write([uint32]$dataOffset)
    $dataOffset += $ms.Length
}

foreach ($ms in $imageStreams) {
    $writer.Write($ms.ToArray())
    $ms.Dispose()
}

[System.IO.File]::WriteAllBytes($iconPath, $stream.ToArray())
$stream.Dispose()

Write-Host "Icon created: $iconPath"
