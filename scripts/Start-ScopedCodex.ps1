param(
    [Parameter(Mandatory = $true)][string]$SessionId,
    [Parameter(Mandatory = $true)][string]$WorkingDirectory,
    [Parameter(Mandatory = $true)][string]$ProviderName,
    [Parameter(Mandatory = $true)][string]$BaseUrl,
    [Parameter(Mandatory = $true)][string]$Model,
    [Parameter(Mandatory = $true)][string]$RunDirectory,
    [ValidateSet("True", "False")][string]$RequiresOpenAIAuth = "False",
    [string]$SearchMcpUrl = ""
)

$ErrorActionPreference = "Stop"
Set-Location $WorkingDirectory

$SessionFile = Join-Path $RunDirectory "$SessionId.json"
$Metadata = @{
    id = $SessionId
    pid = $PID
    provider = $ProviderName
    model = $Model
    cwd = $WorkingDirectory
    search = -not [string]::IsNullOrWhiteSpace($SearchMcpUrl)
    startedAt = (Get-Date).ToUniversalTime().ToString("o")
}
$Metadata | ConvertTo-Json | Set-Content -Path $SessionFile -Encoding utf8

$CodexArgs = @(
    "--no-daemon",
    "-c", "model_provider=`"proxydesk`"",
    "-c", "model=`"$Model`"",
    "-c", "model_providers.proxydesk.name=`"ProxyDesk $ProviderName`"",
    "-c", "model_providers.proxydesk.base_url=`"$BaseUrl`"",
    "-c", "model_providers.proxydesk.env_key=`"PROXYDESK_API_KEY`"",
    "-c", "model_providers.proxydesk.wire_api=`"responses`"",
    "-c", "model_providers.proxydesk.requires_openai_auth=$($RequiresOpenAIAuth.ToLowerInvariant())",
    "-c", "model_providers.proxydesk.supports_websockets=false"
)

if (-not [string]::IsNullOrWhiteSpace($SearchMcpUrl)) {
    $CodexArgs += @("-c", "mcp_servers.proxydesk_search.url=`"$SearchMcpUrl`"")
}

$host.UI.RawUI.WindowTitle = "ProxyDesk Scoped Codex - $ProviderName - $Model"
Write-Host "ProxyDesk scoped runtime"
Write-Host "Provider: $ProviderName"
Write-Host "Model: $Model"
Write-Host "Working directory: $WorkingDirectory"
Write-Host "Search MCP: $SearchMcpUrl"
Write-Host "This process does not modify your global Codex configuration."
Write-Host ""

& codex @CodexArgs
