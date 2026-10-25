# Altirra Debug for ATasm

Debug Atari 8-bit assembly in Visual Studio Code with Altirra as the emulator.
Source breakpoints, stepping, registers, watches and memory edits stay in VS Code.
An embedded Atari display accepts keyboard input without switching to the emulator.

The extension builds and debugs ATasm programs directly through Altirra.

**Status:** early developer release. Linux x86-64 with Wine and Altirra 4.10 is the
primary test environment. A native Windows x64 path is implemented but has not yet
been tested on a Windows machine. macOS, web VS Code, WSL/SSH UI forwarding and
other CPU architectures are not supported in this release.

## Features

- ATasm builds with source mapping across includes and binary assets.
- Standard VS Code breakpoints, Continue, Pause, Step In and Step Over.
- A/X/Y/S/P/PC register inspection and editing.
- Byte expressions (`COUNTER`, `BUFFER+5`, `$6000`), expandable range watches
  (`BUFFER[256]`), memory dumps and copy-as-hex.
- CPU read/write/access breakpoints on bytes or ranges.
- Register/RAM edits staged while paused and applied before the next step/Continue.
- Embedded display, target 20 updates/s, including the paused raster image.
- Keyboard input and Start/Select/Option buttons in the display panel.
- Automatic entry-point detection from the XEX RUNAD vector; optional entry label.
- Optional MyDOS debug-disk creation for projects that load files through D:.
- Dedicated Wine prefixes outside the workspace, and no emulator PNG tracepoints
  in the normal running display path.

## Prerequisites

Install these separately; this repository bundles neither the emulator, assembler,
Wine, nor Atari ROMs:

| Component | Linux | Native Windows (experimental) |
|---|---|---|
| VS Code | 1.85+ | 1.85+ |
| Python | 3.10+, `python3` | 3.10+, `python` |
| ATasm | Native executable on PATH or configured path | Native `atasm.exe` |
| Altirra | `Altirra64.exe`, tested with 4.10 | `Altirra64.exe`, x64 |
| Wine | `wine` and `wineboot`, x64 support | Not used |

Altirra: [official download/source site](https://www.virtualdub.org/altirra.html).
ATasm: [upstream repository](https://github.com/CycoPH/atasm).
The built-in Altirra LLE OS is selected by default, so no Atari ROM download is
required for the included example. Compatibility with a particular game may
require different emulator settings. Memory is currently configured as 64 KiB.

## Install a VSIX

Download the `.vsix` from a release, or build one from this repository:

```sh
python3 scripts/package.py
code --install-extension dist/vscode-altirra-debug-0.1.3.vsix
```

On Windows use `python` instead of `python3`. A prebuilt x64 Windows helper is
included with its corresponding C source. No npm dependencies or pip packages are
needed for installation, tests or local packaging.

Run **Altirra: Configure Tools** from the Command Palette (**F1** or
**Ctrl+Shift+P**). Select `Altirra64.exe`, then enter the ATasm and Python
executables, plus Wine/wineboot on Linux. Commands already on PATH can retain
their defaults. The wizard saves paths for the current workspace and checks them.
Cancelling before the last prompt leaves the settings unchanged.

A first launch with no Altirra path opens the wizard automatically. You can rerun
**Altirra: Configure Tools** to change paths, or **Altirra: Check Setup** to validate
them without launching the emulator. Paths can also be set in Settings under
**Altirra Debug**, or overridden per launch configuration.

If **Atasm Altirra Bridge** is installed, its F5 binding may start its own build.
Use **Run and Debug** (**Ctrl+Shift+D**), select an **Altirra** configuration, and
click the green triangle. For reliable F5 use, disable the conflicting extension
**for this workspace**. Our extension warns about this conflict and provides a
button to open the other extension's details.

## Try the independent playground

1. Open **`examples/hello` as the VS Code folder**.
2. Trust that folder and run **Altirra: Configure Tools**.
3. Open **Run and Debug** (Ctrl+Shift+D), select **Altirra: standalone playground**,
   and click the green triangle. F5 also works when no other extension intercepts it.
4. The first stop is `START`. Add a breakpoint at `REGTEST` and Continue.
5. In Variables, change A to `$55`; F10 executes the NOP, and the following
   `STORE` writes A to `OBSERVED`.
6. Add Watch `BUFFER[16]` and expand it. Individual bytes are editable.
7. Continue and click the Atari image to enable keyboard input.

The example updates a counter and retains console presses in `LASTCONSOLE` and
`CONSOLECOUNT`. Add a breakpoint at `CONSOLEPRESS`, then click **Select**:
`LASTCONSOLE` should retain `$05` after stopping. Idle `$07` writes do not trigger
that source breakpoint. `KEYPRESS` is a separate stopping point for ordinary keys.
`LASTKEY` contains an Atari keyboard scan code, not ASCII.

Watches are paused-state views; they are not live telemetry during execution.
The image is live, but the CPU must be running to accept keyboard key-down events.
F5/F10/F11 remain debugger controls. Console keys: F2 Start, F3 Select, F4 Option.

## Use your own ATasm project

Create `.vscode/launch.json` in the project:

```json
{
  "version": "0.2.0",
  "configurations": [{
    "type": "altirra-debug",
    "request": "launch",
    "name": "Altirra: My game",
    "source": "${workspaceFolder}/main.asm",
    "cwd": "${workspaceFolder}",
    "includePaths": ["${workspaceFolder}/include"],
    "watchLabels": ["GameState", "Counter"],
    "stopOnEntry": true
  }]
}
```

Tool paths can also be overridden per launch. `entry` optionally names a label;
when omitted the backend reads the RUNAD vector from the built XEX. The source
working directory matters for relative `.include` and `.incbin` paths.
The extension writes build outputs and emulator state to its own storage, rather
than changing or cleaning your project's build directory.

For existing build tasks, provide `program`, `symbols` and `listing`, and optionally
VS Code's `preLaunchTask`. See [configuration](docs/CONFIGURATION.md) for this and
MyDOS assets, defines and supported emulator settings.

## Limits worth knowing


This is a 6502/64-KiB debugger, not a reconstruction of Altirra's full debugger UI.
There is one CPU stack frame; Step Out, reverse debugging, conditional breakpoints
and logpoints are not implemented. Macro expansions or repeated includes can make
a source line ambiguous; select an unambiguous instruction line instead.

Register/RAM edits are **pending until resume**. RAM writes are restricted to
`$0000..$BFFF`, at most 4096 bytes per request; ROM, I/O and banked views are not
writable through this interface. Data breakpoints observe CPU accesses, not ANTIC
DMA. Live variable sampling is not implemented.

The native emulator window must remain open and not minimized for surface capture.
It may stay behind VS Code. A minimized/unavailable surface leaves a labelled
cached image. Refresh is a target, not a guarantee of 20 delivered images/s.
ASCII, modifiers, arrows and common control keys are supported; international
layouts/AltGr and joystick emulation need further testing or native input mappings.

Other assembly extensions can intercept F5/Shift+F5. See
[troubleshooting](docs/TROUBLESHOOTING.md) for scoped keyboard overrides.

## Develop and publish

```sh
python3 scripts/test.py
make -C backend/native
python3 scripts/package.py
```

The unit suite does not require Altirra. The optional real-emulator test is:

```sh
node tests/integration.js --altirra /path/to/Altirra64.exe
```

It creates its own temporary workspace/cache and dedicated Wine prefix. See
[development](docs/DEVELOPMENT.md) and [publishing](docs/PUBLISHING.md).

License: GPL-3.0-only. The bundled helper source and build recipe are included.
The publisher ID `altirra-debug-local` is a local development identity; register
your own publisher ID before publishing to the VS Code Marketplace.
