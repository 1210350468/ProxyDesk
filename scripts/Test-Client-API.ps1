$ErrorActionPreference = 'Stop'
$ConfigFile = Join-Path $env:USERPROFILE 'ProxyDesk-Connection.json'
$Config = Get-Content $ConfigFile -Raw | ConvertFrom-Json
$ModelsJson = & curl.exe --silent --show-error --fail-with-body --max-time 15 `
    -H "Authorization: Bearer $($Config.apiKey)" "$($Config.baseUrl)/models"
if ($LASTEXITCODE -ne 0) { throw 'The model list request failed' }
$Models = $ModelsJson | ConvertFrom-Json
if (-not $Models.data -or -not ($Models.data.id -contains $Config.model)) {
    throw 'Configured model is not available through the shared API'
}

$Payload = @{
    model = $Config.model
    messages = @(@{ role = 'user'; content = 'Reply with exactly CLIENT_READY' })
    stream = $false
    max_tokens = 64
} | ConvertTo-Json -Depth 5

$WorkDirectory = Join-Path $env:USERPROFILE '.local-check\proxydesk'
New-Item -ItemType Directory -Path $WorkDirectory -Force | Out-Null
$RequestFile = Join-Path $WorkDirectory 'request.json'
Set-Content -Path $RequestFile -Encoding Ascii -Value $Payload
$ResultJson = & curl.exe --silent --show-error --fail-with-body --max-time 90 `
    -X POST -H "Authorization: Bearer $($Config.apiKey)" -H 'Content-Type: application/json' `
    --data-binary "@$RequestFile" "$($Config.baseUrl)/chat/completions"
Remove-Item $RequestFile -Force
if ($LASTEXITCODE -ne 0) { throw 'The chat request failed' }
$Result = $ResultJson | ConvertFrom-Json

if (-not $Result.choices[0].message) {
    throw 'The upstream did not return a chat completion message'
}

Write-Output "CLIENT_API_MODELS=$($Models.data.Count)"
Write-Output "CLIENT_API_MODEL=$($Config.model)"
Write-Output 'CLIENT_API_VERIFIED=PASS'
