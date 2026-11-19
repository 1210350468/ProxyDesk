param(
    [string]$Model = '',
    [string]$WorkingDirectory = $PWD.Path
)

$ErrorActionPreference = 'Stop'
$Config = Get-Content (Join-Path $env:USERPROFILE 'ProxyDesk-Connection.json') -Raw | ConvertFrom-Json
$SelectedModel = if ($Model) { $Model } else { $Config.model }

$env:ANTHROPIC_BASE_URL = $Config.baseUrl -replace '/v1$', ''
$env:ANTHROPIC_AUTH_TOKEN = $Config.apiKey
$env:ANTHROPIC_MODEL = $SelectedModel
$env:ANTHROPIC_DEFAULT_HAIKU_MODEL = $SelectedModel
$env:ANTHROPIC_DEFAULT_SONNET_MODEL = $SelectedModel
$env:ANTHROPIC_DEFAULT_OPUS_MODEL = $SelectedModel
$env:CLAUDE_CODE_SUBAGENT_MODEL = $SelectedModel

Set-Location $WorkingDirectory
& claude --model $SelectedModel
