# Optional Master startup intro on Windows

This add-on plays a 12-second silver dragon intro over the real, already-themed Codex window and then removes itself. Its wallpaper comes from the current active theme. It does not replace the native app, keep an intro watcher running, or change model/provider settings.

The add-on requires an existing Windows Setup installation of Codex Dream Skin, its signed bundled Node.js 22+ runtime, and a registered Codex Store package. Keep `windows/scripts/start-with-intro.ps1`, `windows/scripts/startup-intro.mjs`, `runtime/startup-intro.js` and `runtime/image-metadata.mjs` in the same relative layout. Personal art and local state are not part of the repository.

Use a shortcut with this target, substituting the installed add-on script path:

```powershell
powershell.exe -NoProfile -ExecutionPolicy RemoteSigned -WindowStyle Hidden -File "<add-on>\windows\scripts\start-with-intro.ps1" -PromptRestart
```

Launch that shortcut from Explorer. The wrapper delegates startup to the existing installed launcher, including its confirmation before restarting a normal Codex session. A healthy skinned session is reused. Starting a restart helper from inside Codex can make Windows close the child helper when Codex exits; the external shortcut avoids that lifetime problem.

The intro moves through a pulsing silver HUD portrait, a shower of ice-bright fragments, the dragon's eyes opening, and a resolve into the active wallpaper before revealing Codex. It plays once per explicit shortcut invocation. Theme reinjection and page navigation do not play it again. The renderer honors reduced motion and provides a skip action. Failure to prepare the intro leaves the current Codex window available and reports a warning.

To preview on the existing live session without running the app launcher:

```powershell
powershell.exe -NoProfile -ExecutionPolicy RemoteSigned -File "<add-on>\windows\scripts\start-with-intro.ps1" -PreviewOnly -Replay
```

An optional `-ClosedImagePath "<local-image>.png"` supplies the closed-eye pose; `-DurationMs 12000` sets duration between 1.8 and 15 seconds, matching the renderer's supported range. Both images must be valid local PNG/JPEG/WebP files within the 10 MiB, 16384px and 50MP limits. Theme image references must be plain filenames; URLs, directory escapes, links and alternate data streams are rejected.

The controller reads bounded current state, verifies the registered Store process owns the loopback listener using installed PowerShell helpers, pins the recorded Browser ID for the entire invocation, and probes visible native Codex shell markers plus the active wallpaper. Wallpaper verification accepts the injected style element or the actual registered sheet still present in `document.adoptedStyleSheets`. Pet surfaces, blank pages, foreign ports and changed browser identities are excluded. Completion, deliberate skipping, hiding, reduced motion and an already-played result are clean outcomes; image errors, render errors and watchdog deadlines report failure while preserving the window.

For verification, run `node --test windows/tests/startup-intro.test.mjs`, `node --check windows/scripts/startup-intro.mjs`, and parse the PowerShell wrapper with `System.Management.Automation.Language.Parser`. Real Store ownership, skipping, reduced motion and the final wallpaper handoff also require a live Windows check. This is a local add-on, not a packaged upstream release or macOS implementation.
