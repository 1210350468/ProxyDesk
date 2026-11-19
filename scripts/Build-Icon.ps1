$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Drawing

$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$AssetDir = Join-Path $Root "assets"
$PngPath = Join-Path $AssetDir "icon.png"
$IcoPath = Join-Path $AssetDir "icon.ico"

New-Item -ItemType Directory -Force -Path $AssetDir | Out-Null

$Size = 256
$Bitmap = New-Object System.Drawing.Bitmap($Size, $Size)
$Graphics = [System.Drawing.Graphics]::FromImage($Bitmap)
$Graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$Graphics.Clear([System.Drawing.Color]::Transparent)

$BackgroundPath = New-Object System.Drawing.Drawing2D.GraphicsPath
$Radius = 52
$Diameter = $Radius * 2
$BackgroundPath.AddArc(12, 12, $Diameter, $Diameter, 180, 90)
$BackgroundPath.AddArc(244 - $Diameter, 12, $Diameter, $Diameter, 270, 90)
$BackgroundPath.AddArc(244 - $Diameter, 244 - $Diameter, $Diameter, $Diameter, 0, 90)
$BackgroundPath.AddArc(12, 244 - $Diameter, $Diameter, $Diameter, 90, 90)
$BackgroundPath.CloseFigure()

$BackgroundBrush = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
    (New-Object System.Drawing.Point(24, 20)),
    (New-Object System.Drawing.Point(232, 236)),
    ([System.Drawing.Color]::FromArgb(255, 24, 29, 44)),
    ([System.Drawing.Color]::FromArgb(255, 8, 11, 18))
)
$Graphics.FillPath($BackgroundBrush, $BackgroundPath)

$RingPen = New-Object System.Drawing.Pen(([System.Drawing.Color]::FromArgb(255, 34, 43, 67)), 18)
$Graphics.DrawEllipse($RingPen, 64, 64, 128, 128)

$ArcPen = New-Object System.Drawing.Pen(([System.Drawing.Color]::FromArgb(255, 124, 156, 255)), 16)
$ArcPen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
$ArcPen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
$Graphics.DrawArc($ArcPen, 63, 65, 138, 136, 34, 118)

$TopPen = New-Object System.Drawing.Pen(([System.Drawing.Color]::FromArgb(255, 157, 180, 255)), 11)
$TopPen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
$TopPen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
$Graphics.DrawArc($TopPen, 65, 57, 137, 133, 202, 105)

$NodeBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 238, 243, 255))
$BlueBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 128, 157, 255))
$Graphics.FillEllipse($NodeBrush, 65, 141, 26, 26)
$Graphics.FillEllipse($BlueBrush, 187, 130, 26, 26)
$Graphics.FillEllipse($BlueBrush, 69, 94, 20, 20)

$Font = New-Object System.Drawing.Font("Segoe UI", 78, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
$TextBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 247, 249, 255))
$Graphics.DrawString("P", $Font, $TextBrush, 94, 76)

$Bitmap.Save($PngPath, [System.Drawing.Imaging.ImageFormat]::Png)

$IconHandle = $Bitmap.GetHicon()
$Icon = [System.Drawing.Icon]::FromHandle($IconHandle)
$Stream = [System.IO.File]::Open($IcoPath, [System.IO.FileMode]::Create)
$Icon.Save($Stream)
$Stream.Close()

$Graphics.Dispose()
$BackgroundBrush.Dispose()
$RingPen.Dispose()
$ArcPen.Dispose()
$TopPen.Dispose()
$NodeBrush.Dispose()
$BlueBrush.Dispose()
$TextBrush.Dispose()
$Font.Dispose()
$BackgroundPath.Dispose()
$Bitmap.Dispose()

Write-Output "ICON_PNG=$PngPath"
Write-Output "ICON_ICO=$IcoPath"
