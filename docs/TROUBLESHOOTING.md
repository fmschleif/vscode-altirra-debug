# Troubleshooting

## F5 starts a different extension's build

Atasm Altirra Bridge and other assembler extensions can bind F5 globally, even
while this debugger is paused. A message about `theapp.asm` or its bundled ATasm
is a different build path. Use the debug toolbar's Continue button to distinguish
that from a backend problem. Either disable the conflicting extension **for this
workspace**, or add explicit **user** keybindings through VS Code's keyboard
settings. Example:

```json
[
  {"key":"f5", "command":"workbench.action.debug.start",
   "when":"config.altirra-debug.enableDebugKeys && !inDebugMode"},
  {"key":"f5", "command":"workbench.action.debug.continue",
   "when":"debugType == altirra-debug && debugState == stopped"},
  {"key":"shift+f5", "command":"workbench.action.debug.stop",
   "when":"debugType == altirra-debug && inDebugMode"}
]
```

Add the entries to your existing keybindings array, preserving other bindings.
Set `"altirra-debug.enableDebugKeys": true` only in the intended workspace.
This extension never silently rewrites your global keybindings.

## Setup / executable errors

Run **Altirra: Check Setup** and inspect **Output → Altirra Debug**. Configure the
actual executable paths. On Linux, ATasm requires executable permission; a Windows
`.exe` opened through Wine only requires read permission. Do not enter shell command
strings in a path setting. Python 3.10+ and Node/VS Code run on the host, not inside Wine.

## Empty Variables or Watch

Wait for an actual stop. Variables and watches use the last CPU-visible 64-KiB
snapshot. Running values are intentionally unavailable. Add expressions such as
`COUNTER`, `BUFFER+5`, `$6000`, or `BUFFER[16]`. These are simple byte/address
expressions, not arbitrary debugger commands or a full assembler expression evaluator.
A scope containing no labels can be populated with `watchLabels` in launch.json.

## Edits have not changed the Atari yet

The **pending resume** annotation is intentional. An edit changes the staged
register/RAM view only; native Altirra receives it before the next F10/F11/Continue.
Disconnect discards staged edits. Do not concurrently edit state through Altirra's
own debugger; that is not synchronized with the adapter's pending transaction.

## Image frozen or apparently different

The panel reads the actual display surface without advancing the Atari CPU.
A paused raster may contain a yellow scanline or incomplete drawing. That is an
instruction-level halt, not an image corruption. Keep the Altirra window open and
not minimized. A cached-image status means native capture was unavailable.
Hidden panels and auto-refresh-off do not capture. `altirra-debug.displayFps` defaults
to 20; close/reopen the panel after changing it. It can be reduced on slower hosts.

There are no running PNG tracepoints in the normal path. Rendering/encoding takes
place outside the emulator; the view does not intentionally pause the CPU to read
watch values. Nevertheless no refresh rate or audio latency is guaranteed on all
Wine/display-driver combinations.

## Console-key watches always show $07

`CONSOL` returns to idle when released, and Watch refreshes at stops. In the
included example, watch `LASTCONSOLE` and `CONSOLECOUNT`, or break at `CONSOLEPRESS`.
They retain short pulses. A generic write breakpoint on a variable updated every
frame would also stop on idle updates, so it is not the right test for key presses.

## Another session / stalled startup

Use Stop before starting another session. A workspace lock prevents two backends
from sharing the same Wine prefix. Stop during launch requests cancellation.
A cold prefix/emulator start can take up to about a minute. If startup fails, read
the Output channel and check for firmware/setup dialogs in the emulator window.
The native Windows path is experimental; report Python, VS Code, Altirra versions,
OS architecture and a minimal source reproducer when opening an issue.
