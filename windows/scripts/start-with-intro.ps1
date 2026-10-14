[CmdletBinding()]
param(
  [switch]$PromptRestart,
  [switch]$PreviewOnly,
  [switch]$Replay,
  [string]$ClosedImagePath,
  [ValidateRange(1800, 15000)][int]$DurationMs = 12000
)

$ErrorActionPreference = 'Stop'
$payloadRoot = Join-Path $env:LOCALAPPDATA 'Programs\CodexDreamSkin\payload'
$starter = Join-Path $payloadRoot 'scripts\start-dream-skin.ps1'
$common = Join-Path $payloadRoot 'scripts\common-windows.ps1'
$controller = Join-Path $PSScriptRoot 'startup-intro.mjs'
$renderer = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..\runtime\startup-intro.js'))
$statePath = Join-Path $env:LOCALAPPDATA 'CodexDreamSkin\state.json'

try {
  if (-not (Test-Path -LiteralPath $common -PathType Leaf)) {
    throw 'Install Codex Dream Skin before using the optional startup intro.'
  }
  . $common
  if (-not $PreviewOnly) {
    $previousBrowserId = $null
    try {
      if (Test-Path -LiteralPath $statePath -PathType Leaf) {
        $previousBrowserId = (Read-DreamSkinState -Path $statePath).browserId
      }
    } catch { }
    $node = Get-DreamSkinNodeRuntime
    # A child process isolates the installed launcher's exit/confirmation path.
    # Run this wrapper from Explorer, not from an app it might need to restart.
    $startArgs = @('-NoProfile', '-ExecutionPolicy', 'RemoteSigned', '-File', $starter)
    if ($PromptRestart) { $startArgs += '-PromptRestart' }
    $powershell = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
    # Capturing this launcher's output can wait on handles inherited by its
    # persistent injector. Wait for the launcher itself, not its process tree.
    $start = Start-Process -FilePath $powershell `
      -ArgumentList (ConvertTo-DreamSkinArgumentLine -Arguments $startArgs) `
      -WindowStyle Hidden -PassThru
    $coverAttemptedFor = $null
    while ($true) {
      $start.Refresh()
      if (-not $coverAttemptedFor -and (Test-Path -LiteralPath $statePath -PathType Leaf) -and
        (Get-Item -LiteralPath $statePath).Length -le 65536) {
        try {
          $candidate = Read-DreamSkinState -Path $statePath
          if ($candidate.browserId -and $candidate.browserId -cne $previousBrowserId) {
            $coverAttemptedFor = "$($candidate.browserId)"
            $null = Invoke-DreamSkinNative -FilePath $node.Path `
              -ArgumentList @($controller, '--early-cover')
          }
        } catch { }
      }
      if ($start.HasExited) { break }
      Start-Sleep -Milliseconds 200
    }
    $start.WaitForExit()
    if ($start.ExitCode -ne 0) { throw 'Dream Skin startup did not complete; the intro was skipped.' }
  }

  if (-not (Test-Path -LiteralPath $statePath -PathType Leaf) -or
    (Get-Item -LiteralPath $statePath).Length -gt 65536) {
    throw 'No bounded Dream Skin session state is available.'
  }
  $state = Read-DreamSkinState -Path $statePath
  $codex = Get-DreamSkinCodexInstallFromState -State $state
  if ($null -eq $codex -or -not $state.browserId) {
    throw 'The recorded session is not a registered Codex Store package.'
  }
  $identity = Get-DreamSkinVerifiedCdpIdentity -Port ([int]$state.port) -Codex $codex
  if ($null -eq $identity -or $identity.BrowserId -cne $state.browserId) {
    throw 'The recorded Codex session is no longer current; the intro was skipped.'
  }
  if (-not $node) { $node = Get-DreamSkinNodeRuntime }
  $introArgs = @($controller, '--renderer', $renderer, '--duration-ms', "$DurationMs")
  # Each explicit shortcut invocation may play once. No watcher owns the intro.
  if (-not $PreviewOnly -or $Replay) { $introArgs += '--replay' }
  if ($ClosedImagePath) {
    $introArgs += @('--closed-image', [System.IO.Path]::GetFullPath($ClosedImagePath))
  }
  $intro = Invoke-DreamSkinNative -FilePath $node.Path -ArgumentList $introArgs
  foreach ($line in $intro.Output) { Write-Host $line }
  if ($intro.ExitCode -ne 0) {
    Write-Warning 'The startup intro was skipped. The existing Codex window is still available.'
  }
} catch {
  Write-Warning "Startup intro unavailable: $($_.Exception.Message)"
}
