import { readFileSync, writeFileSync } from 'fs'
import { resolve } from 'path'
import { randomBytes } from 'crypto'
import { parseDocument, YAMLSeq, YAMLMap } from 'yaml'
import type { CostLimitPeriod } from './config.js'

export interface ClientEntry {
  name: string
  token: string
  cost_limit_usd?: number
  cost_limit_period?: CostLimitPeriod
}

export interface ClientLimitInput {
  cost_limit_usd?: number | null
  cost_limit_period?: CostLimitPeriod | null
}

const NAME_RE = /^[a-zA-Z0-9_.-]{1,64}$/
const VALID_PERIODS: CostLimitPeriod[] = ['lifetime', 'monthly', 'daily']

function configPath(): string {
  return resolve(
    process.argv[2] ||
    process.env.CCG_CONFIG_PATH ||
    '/app/data/config.yaml',
  )
}

function loadDoc(path: string) {
  const raw = readFileSync(path, 'utf-8')
  return parseDocument(raw)
}

function getTokensSeq(doc: ReturnType<typeof parseDocument>): YAMLSeq {
  const auth = doc.getIn(['auth'], true) as YAMLMap | undefined
  if (!auth) throw new Error('config: auth section missing')
  let tokens = auth.get('tokens', true) as YAMLSeq | undefined
  if (!tokens) {
    tokens = new YAMLSeq()
    auth.set('tokens', tokens)
  }
  return tokens
}

function readEntry(item: YAMLMap): ClientEntry | null {
  const name = item.get('name')
  const token = item.get('token')
  if (typeof name !== 'string' || typeof token !== 'string') return null
  const limitRaw = item.get('cost_limit_usd')
  const periodRaw = item.get('cost_limit_period')
  const cost_limit_usd = typeof limitRaw === 'number' && limitRaw > 0 ? limitRaw : undefined
  const cost_limit_period =
    typeof periodRaw === 'string' && (VALID_PERIODS as string[]).includes(periodRaw)
      ? (periodRaw as CostLimitPeriod)
      : undefined
  return { name, token, cost_limit_usd, cost_limit_period }
}

function applyLimitToYamlEntry(entry: YAMLMap, input: ClientLimitInput): void {
  if (input.cost_limit_usd === null || input.cost_limit_usd === 0) {
    entry.delete('cost_limit_usd')
    entry.delete('cost_limit_period')
    return
  }
  if (typeof input.cost_limit_usd === 'number' && input.cost_limit_usd > 0) {
    entry.set('cost_limit_usd', input.cost_limit_usd)
    const period =
      typeof input.cost_limit_period === 'string' &&
      (VALID_PERIODS as string[]).includes(input.cost_limit_period)
        ? input.cost_limit_period
        : 'lifetime'
    entry.set('cost_limit_period', period)
  } else if (input.cost_limit_period !== undefined && input.cost_limit_period !== null) {
    // period without limit: ignore
  }
}

export function listClients(): ClientEntry[] {
  const doc = loadDoc(configPath())
  const tokens = getTokensSeq(doc)
  const out: ClientEntry[] = []
  for (const item of tokens.items) {
    if (item instanceof YAMLMap) {
      const e = readEntry(item)
      if (e) out.push(e)
    }
  }
  return out
}

export function addClient(name: string, limit?: ClientLimitInput): ClientEntry {
  if (!NAME_RE.test(name)) {
    throw new Error('client name must be 1-64 chars, [a-zA-Z0-9_.-]')
  }
  const path = configPath()
  const doc = loadDoc(path)
  const tokens = getTokensSeq(doc)

  for (const item of tokens.items) {
    if (item instanceof YAMLMap && item.get('name') === name) {
      throw new Error(`client "${name}" already exists`)
    }
  }

  const token = randomBytes(32).toString('hex')
  const entry = new YAMLMap()
  entry.set('name', name)
  entry.set('token', token)
  if (limit) applyLimitToYamlEntry(entry, limit)
  tokens.add(entry)

  writeFileSync(path, doc.toString(), 'utf-8')
  const result = readEntry(entry)
  return result || { name, token }
}

export function setClientLimit(name: string, limit: ClientLimitInput): ClientEntry {
  const path = configPath()
  const doc = loadDoc(path)
  const tokens = getTokensSeq(doc)
  let target: YAMLMap | null = null
  for (const item of tokens.items) {
    if (item instanceof YAMLMap && item.get('name') === name) {
      target = item
      break
    }
  }
  if (!target) throw new Error(`client "${name}" not found`)
  applyLimitToYamlEntry(target, limit)
  writeFileSync(path, doc.toString(), 'utf-8')
  const result = readEntry(target)
  if (!result) throw new Error('failed to read updated entry')
  return result
}

export function removeClient(name: string): boolean {
  const path = configPath()
  const doc = loadDoc(path)
  const tokens = getTokensSeq(doc)

  let removedAt = -1
  for (let i = 0; i < tokens.items.length; i++) {
    const item = tokens.items[i]
    if (item instanceof YAMLMap && item.get('name') === name) {
      removedAt = i
      break
    }
  }
  if (removedAt === -1) return false

  tokens.delete(removedAt)
  if (tokens.items.length === 0) {
    throw new Error('cannot remove the last client — at least one token must remain')
  }
  writeFileSync(path, doc.toString(), 'utf-8')
  return true
}

export interface LauncherOptions {
  name: string
  token: string
  gatewayAddr: string  // e.g. "ccg.example.com" or "host:port"
  scheme: 'http' | 'https'
}

export function buildPowerShellLauncherScript(opts: LauncherOptions): string {
  const tlsBypass =
    opts.scheme === 'https'
      ? '\n# Accept self-signed TLS cert from gateway\n$env:NODE_TLS_REJECT_UNAUTHORIZED = "0"\n'
      : ''
  return `# CC Gateway Client Launcher (Windows / PowerShell)
#
# Usage:
#   .\\cc-${opts.name}.ps1                  Start Claude Code through gateway
#   .\\cc-${opts.name}.ps1 --print "hi"     Single-shot mode
#   .\\cc-${opts.name}.ps1 install          Install as 'ccg' system command (user PATH)
#   .\\cc-${opts.name}.ps1 uninstall        Remove 'ccg' and restore native claude
#   .\\cc-${opts.name}.ps1 hijack           Alias claude -> ccg in PowerShell profile
#   .\\cc-${opts.name}.ps1 release          Undo hijack
#   .\\cc-${opts.name}.ps1 native           Run native claude (bypass gateway, one-time)
#   .\\cc-${opts.name}.ps1 status           Show gateway URL + hijack state + health
[CmdletBinding()]
param([Parameter(ValueFromRemainingArguments=$true)][string[]]$RestArgs)

$GatewayUrl  = "${opts.scheme}://${opts.gatewayAddr}"
$ClientToken = "${opts.token}"
${tlsBypass}
$InstallDir  = Join-Path $env:LOCALAPPDATA "ccg-bin"
$InstallPs1  = Join-Path $InstallDir "ccg.ps1"
$InstallCmd  = Join-Path $InstallDir "ccg.cmd"
$ProfilePath = $PROFILE.CurrentUserAllHosts
$AliasTag    = "# cc-gateway alias"

function Add-ToUserPath {
  param([string]$Dir)
  $userPath = [Environment]::GetEnvironmentVariable("PATH", "User")
  if (-not $userPath) { $userPath = "" }
  $parts = $userPath -split ';' | Where-Object { $_ -ne "" }
  if ($parts -notcontains $Dir) {
    $new = (@($Dir) + $parts) -join ';'
    [Environment]::SetEnvironmentVariable("PATH", $new, "User")
    return $true
  }
  return $false
}

function Test-AliasInProfile {
  if (-not (Test-Path $ProfilePath)) { return $false }
  return [bool](Select-String -Path $ProfilePath -Pattern ([regex]::Escape($AliasTag)) -Quiet -ErrorAction SilentlyContinue)
}

function Remove-AliasFromProfile {
  if (-not (Test-Path $ProfilePath)) { return }
  (Get-Content $ProfilePath) | Where-Object { $_ -notlike "*$AliasTag*" } | Set-Content $ProfilePath
}

function Invoke-Install {
  if (-not (Test-Path $InstallDir)) { New-Item -ItemType Directory -Path $InstallDir | Out-Null }
  Copy-Item -Path $PSCommandPath -Destination $InstallPs1 -Force
  $cmdContent = @'
@echo off
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0ccg.ps1" %*
'@
  Set-Content -Path $InstallCmd -Value $cmdContent -Encoding ASCII
  $added = Add-ToUserPath $InstallDir
  Write-Host "Installed as 'ccg' at $InstallDir."
  if ($added) {
    Write-Host ""
    Write-Host "Added $InstallDir to your user PATH. Open a NEW terminal for 'ccg' to be found."
  }
  Write-Host ""
  Write-Host "  ccg              Start Claude Code through gateway"
  Write-Host "  ccg hijack       Make 'claude' also go through gateway"
  Write-Host "  ccg release      Restore 'claude' to native"
  Write-Host "  ccg status       Show gateway connection status"
  Write-Host "  ccg help         Show this help"
}

function Invoke-Uninstall {
  Remove-Item -Path $InstallPs1 -ErrorAction SilentlyContinue
  Remove-Item -Path $InstallCmd -ErrorAction SilentlyContinue
  if (Test-AliasInProfile) { Remove-AliasFromProfile }
  Write-Host "Removed. Native 'claude' restored."
}

function Invoke-Hijack {
  if (Test-AliasInProfile) {
    Write-Host "Already active. Run 'ccg release' to undo."
    return
  }
  $dir = Split-Path -Parent $ProfilePath
  if ($dir -and -not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
  if (-not (Test-Path $ProfilePath)) { New-Item -ItemType File -Path $ProfilePath -Force | Out-Null }
  Add-Content -Path $ProfilePath -Value "Set-Alias claude ccg $AliasTag"
  Write-Host "Done. 'claude' now goes through gateway."
  Write-Host "  New PowerShell terminals: automatic."
  Write-Host '  This terminal: reopen or run: . $PROFILE'
  Write-Host "  Undo anytime: ccg release"
}

function Invoke-Release {
  if (Test-AliasInProfile) {
    Remove-AliasFromProfile
    Remove-Item Alias:claude -ErrorAction SilentlyContinue
    Write-Host "Done. 'claude' is back to native."
  } else {
    Write-Host "Nothing to undo - 'claude' is already native."
  }
}

function Invoke-Native {
  $rest = if ($RestArgs.Count -gt 1) { $RestArgs[1..($RestArgs.Count - 1)] } else { @() }
  $app = Get-Command claude -CommandType Application -ErrorAction SilentlyContinue
  if (-not $app) { Write-Error "claude not found"; exit 1 }
  & $app.Source @rest
  exit $LASTEXITCODE
}

function Test-GatewayHealth {
  try {
    $params = @{ Uri = "$GatewayUrl/_health"; TimeoutSec = 3; UseBasicParsing = $true; ErrorAction = 'Stop' }
    if ($PSVersionTable.PSVersion.Major -ge 6) { $params.SkipCertificateCheck = $true }
    else { [System.Net.ServicePointManager]::ServerCertificateValidationCallback = { $true } }
    $r = Invoke-WebRequest @params
    return ($r.StatusCode -lt 500)
  } catch { return $false }
}

function Invoke-Status {
  Write-Host "Gateway:  $GatewayUrl"
  if (Test-AliasInProfile) {
    Write-Host "Hijack:   ON  (claude -> gateway)"
  } else {
    Write-Host "Hijack:   OFF (claude = native)"
  }
  if (Test-GatewayHealth) { Write-Host "Health:   OK" } else { Write-Host "Health:   UNREACHABLE" }
}

function Invoke-Help {
  Write-Host "ccg - Claude Code Gateway Client (Windows)"
  Write-Host ""
  Write-Host "Usage:"
  Write-Host "  ccg                  Start Claude Code through gateway"
  Write-Host "  ccg [claude args]    Pass any arguments to Claude Code"
  Write-Host "  ccg --print 'hi'     Single-shot mode"
  Write-Host ""
  Write-Host "Setup:"
  Write-Host "  ccg install          Install as 'ccg' system command (user PATH)"
  Write-Host "  ccg uninstall        Remove 'ccg' and clean up"
  Write-Host ""
  Write-Host "Routing:"
  Write-Host "  ccg hijack           Make 'claude' go through gateway"
  Write-Host "  ccg release          Restore 'claude' to native"
  Write-Host "  ccg native [args]    Run native claude once (bypass gateway)"
  Write-Host ""
  Write-Host "Info:"
  Write-Host "  ccg status           Show gateway and hijack status"
  Write-Host "  ccg help             Show this help"
}

# Subcommand dispatch
if ($RestArgs -and $RestArgs.Count -gt 0) {
  switch ($RestArgs[0]) {
    'install'   { Invoke-Install; exit 0 }
    'uninstall' { Invoke-Uninstall; exit 0 }
    'hijack'    { Invoke-Hijack; exit 0 }
    'release'   { Invoke-Release; exit 0 }
    'native'    { Invoke-Native }
    'status'    { Invoke-Status; exit 0 }
    'help'      { Invoke-Help; exit 0 }
    '--help'    { Invoke-Help; exit 0 }
    '-h'        { Invoke-Help; exit 0 }
  }
}

# Main: launch through gateway
$claudeApp = Get-Command claude -CommandType Application -ErrorAction SilentlyContinue
if (-not $claudeApp) {
  Write-Error "Error: 'claude' not found. Install Claude Code first:"
  Write-Error "  npm install -g @anthropic-ai/claude-code"
  exit 1
}

$env:ANTHROPIC_API_KEY = $ClientToken
$env:ANTHROPIC_BASE_URL = $GatewayUrl
$env:CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC = "1"
$env:CLAUDE_CODE_ATTRIBUTION_HEADER = "false"

if (-not (Test-GatewayHealth)) {
  Write-Host "Warning: Gateway at $GatewayUrl is not reachable."
  Write-Host "Make sure the gateway is running."
  Write-Host ""
}

& $claudeApp.Source @RestArgs
exit $LASTEXITCODE
`
}

export function buildLauncherScript(opts: LauncherOptions): string {
  const tlsBypass =
    opts.scheme === 'https'
      ? '\n# Accept self-signed TLS cert from gateway\nexport NODE_TLS_REJECT_UNAUTHORIZED=0\n'
      : ''
  return `#!/bin/bash
# CC Gateway Client Launcher
#
# Usage:
#   ./cc-${opts.name}                    Start Claude Code through gateway
#   ./cc-${opts.name} --print "hello"    Single-shot mode
#   ./cc-${opts.name} install            Install as 'ccg' command system-wide
#   ./cc-${opts.name} uninstall          Remove 'ccg' and restore native claude
#   ./cc-${opts.name} native             Run native claude (bypass gateway, one-time)
GATEWAY_URL="${opts.scheme}://${opts.gatewayAddr}"
CLIENT_TOKEN="${opts.token}"
${tlsBypass}
# Pick a writable install dir. Apple Silicon Macs ship without /usr/local/bin
# by default; Intel Macs and most Linux distros have it. Fall back to
# ~/.local/bin so install always works without sudo as a last resort.
if [[ -d /opt/homebrew/bin ]]; then
  INSTALL_DIR="/opt/homebrew/bin"
elif [[ -d /usr/local/bin ]]; then
  INSTALL_DIR="/usr/local/bin"
else
  INSTALL_DIR="$HOME/.local/bin"
  mkdir -p "$INSTALL_DIR"
fi
INSTALL_PATH="$INSTALL_DIR/ccg"
SELF_PATH="$(cd "$(dirname "$0")" && pwd)/$(basename "$0")"
# Detect shell RC file
case "$SHELL" in
  */zsh)  RC_FILE="\${ZDOTDIR:-$HOME}/.zshrc" ;;
  */bash) RC_FILE="$HOME/.bashrc" ;;
  */fish) RC_FILE="\${XDG_CONFIG_HOME:-$HOME/.config}/fish/config.fish" ;;
  *)      RC_FILE="$HOME/.profile" ;;
esac
ALIAS_TAG="# cc-gateway alias"

# ── Subcommands ──

case "$1" in
  install)
    if cp "$0" "$INSTALL_PATH" 2>/dev/null; then :; else
      sudo cp "$0" "$INSTALL_PATH" || { echo "Install failed: cannot write to $INSTALL_PATH"; exit 1; }
    fi
    chmod +x "$INSTALL_PATH" 2>/dev/null || sudo chmod +x "$INSTALL_PATH"
    echo "Installed as 'ccg' at $INSTALL_PATH."
    case ":$PATH:" in
      *":$INSTALL_DIR:"*) ;;
      *)
        echo ""
        echo "Note: $INSTALL_DIR is not on your PATH."
        echo "  Add this line to $RC_FILE and reopen your terminal:"
        echo "    export PATH=\"$INSTALL_DIR:\$PATH\""
        ;;
    esac
    echo ""
    echo "  ccg              Start Claude Code through gateway"
    echo "  ccg hijack       Make 'claude' also go through gateway"
    echo "  ccg release      Restore 'claude' to native"
    echo "  ccg status       Show gateway connection status"
    echo "  ccg help         Show this help"
    exit 0
    ;;

  uninstall)
    rm "$INSTALL_PATH" 2>/dev/null || sudo rm "$INSTALL_PATH"
    if grep -q "$ALIAS_TAG" "$RC_FILE" 2>/dev/null; then
      sed -i.bak "/$ALIAS_TAG/d" "$RC_FILE"
      rm -f "\${RC_FILE}.bak"
    fi
    echo "Removed. Native 'claude' restored."
    exit 0
    ;;

  hijack)
    if grep -q "$ALIAS_TAG" "$RC_FILE" 2>/dev/null; then
      echo "Already active. Run 'ccg release' to undo."
    else
      if [[ "$SHELL" == */fish ]]; then
        echo "alias claude 'ccg' $ALIAS_TAG" >> "$RC_FILE"
      else
        echo "alias claude='ccg' $ALIAS_TAG" >> "$RC_FILE"
      fi
      echo "Done. 'claude' now goes through gateway."
      echo "  New terminals: automatic."
      echo "  This terminal: reopen or run: source $RC_FILE"
      echo "  Undo anytime: ccg release"
    fi
    exit 0
    ;;

  release)
    if grep -q "$ALIAS_TAG" "$RC_FILE" 2>/dev/null; then
      sed -i.bak "/$ALIAS_TAG/d" "$RC_FILE"
      rm -f "\${RC_FILE}.bak"
      # Unalias in current shell
      unalias claude 2>/dev/null
      echo "Done. 'claude' is back to native."
    else
      echo "Nothing to undo — 'claude' is already native."
    fi
    exit 0
    ;;

  native)
    shift
    exec command claude "$@"
    ;;

  status)
    echo "Gateway:  $GATEWAY_URL"
    if grep -q "$ALIAS_TAG" "$RC_FILE" 2>/dev/null; then
      echo "Hijack:   ON  (claude → gateway)"
    else
      echo "Hijack:   OFF (claude = native)"
    fi
    HEALTH=$(curl -sk --max-time 3 "\${GATEWAY_URL}/_health" 2>/dev/null)
    if [[ -n "$HEALTH" ]]; then
      echo "Health:   OK"
    else
      echo "Health:   UNREACHABLE"
    fi
    exit 0
    ;;

  help|--help|-h)
    echo "ccg — Claude Code Gateway Client"
    echo ""
    echo "Usage:"
    echo "  ccg                    Start Claude Code through gateway"
    echo "  ccg [claude args]      Pass any arguments to Claude Code"
    echo "  ccg --print \\"hi\\"       Single-shot mode"
    echo ""
    echo "Setup:"
    echo "  ccg install            Install as 'ccg' system command"
    echo "  ccg uninstall          Remove 'ccg' and clean up"
    echo ""
    echo "Routing:"
    echo "  ccg hijack             Make 'claude' go through gateway"
    echo "  ccg release            Restore 'claude' to native"
    echo "  ccg native [args]      Run native claude once (bypass gateway)"
    echo ""
    echo "Info:"
    echo "  ccg status             Show gateway and hijack status"
    echo "  ccg help               Show this help"
    exit 0
    ;;
esac

# ── Main: launch through gateway ──

# Check claude is installed
if ! command -v claude &>/dev/null; then
  echo "Error: 'claude' not found. Install Claude Code first:"
  echo "  npm install -g @anthropic-ai/claude-code"
  exit 1
fi

# Set env vars for this process only — nothing is written to disk
export ANTHROPIC_API_KEY="$CLIENT_TOKEN"
export ANTHROPIC_BASE_URL="$GATEWAY_URL"
export CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1
export CLAUDE_CODE_ATTRIBUTION_HEADER=false

# Check gateway is reachable
HEALTH=$(curl -sk --max-time 3 "\${GATEWAY_URL}/_health" 2>/dev/null)
if [[ -z "$HEALTH" ]]; then
  echo "Warning: Gateway at \${GATEWAY_URL} is not reachable."
  echo "Make sure the gateway is running."
  echo ""
fi

# Pass all arguments through to claude
exec claude "$@"
`
}
