import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

test("Windows launch handoff completes while the background injector stays alive", {
  skip: process.platform !== "win32",
}, async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "dreamskin-intro-launch-"));
  const powershell = path.join(process.env.SystemRoot, "System32/WindowsPowerShell/v1.0/powershell.exe");
  const payload = path.join(directory, "Programs/CodexDreamSkin/payload/scripts");
  const scripts = path.join(directory, "add-on/windows/scripts");
  const state = path.join(directory, "CodexDreamSkin");
  const pidFile = path.join(directory, "background.pid");
  const marker = path.join(directory, "intro.called");
  let backgroundPid;
  try {
    await Promise.all([fs.mkdir(payload, { recursive: true }), fs.mkdir(scripts, { recursive: true }),
      fs.mkdir(state, { recursive: true })]);
    await fs.copyFile(new URL("../scripts/start-with-intro.ps1", import.meta.url), path.join(scripts, "start-with-intro.ps1"));
    await fs.writeFile(path.join(state, "state.json"), "{}");
    await fs.writeFile(path.join(payload, "common-windows.ps1"), `
function ConvertTo-DreamSkinArgumentLine { param([string[]]$Arguments) return (($Arguments | ForEach-Object { '"' + $_ + '"' }) -join ' ') }
function Read-DreamSkinState { param($Path) return @{ port = 9335; browserId = 'fixture' } }
function Get-DreamSkinCodexInstallFromState { param($State) return @{} }
function Get-DreamSkinVerifiedCdpIdentity { param($Port, $Codex) return @{ BrowserId = 'fixture' } }
function Get-DreamSkinNodeRuntime { return @{ Path = $env:INTRO_TEST_NODE } }
function Invoke-DreamSkinNative { param($FilePath, $ArgumentList) $output = @(& $FilePath @ArgumentList 2>&1); return @{ Output = $output; ExitCode = $LASTEXITCODE } }
`);
    await fs.writeFile(path.join(payload, "start-dream-skin.ps1"), `
param([switch]$PromptRestart)
$child = Start-Process -FilePath (Join-Path $PSHOME 'powershell.exe') -ArgumentList '-NoProfile -Command "Start-Sleep -Seconds 30"' -WindowStyle Hidden -PassThru
[System.IO.File]::WriteAllText($env:INTRO_TEST_PID, "$($child.Id)")
exit 0
`);
    await fs.writeFile(path.join(scripts, "startup-intro.mjs"),
      "import fs from 'node:fs'; fs.writeFileSync(process.env.INTRO_TEST_MARKER, 'called');\n");
    const result = spawnSync(powershell, ["-NoProfile", "-ExecutionPolicy", "RemoteSigned", "-File",
      path.join(scripts, "start-with-intro.ps1")], {
      env: { ...process.env, LOCALAPPDATA: directory, INTRO_TEST_NODE: process.execPath,
        INTRO_TEST_PID: pidFile, INTRO_TEST_MARKER: marker }, encoding: "utf8", timeout: 12000,
    });
    backgroundPid = Number(await fs.readFile(pidFile, "utf8"));
    assert.equal(result.error, undefined, result.error?.message);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.equal(await fs.readFile(marker, "utf8"), "called");
    assert.doesNotThrow(() => process.kill(backgroundPid, 0), "background child should outlive the launcher");
  } finally {
    if (!backgroundPid) backgroundPid = Number(await fs.readFile(pidFile, "utf8").catch(() => "0"));
    if (backgroundPid) { try { process.kill(backgroundPid); } catch {} }
    await fs.rm(directory, { recursive: true, force: true });
  }
});
