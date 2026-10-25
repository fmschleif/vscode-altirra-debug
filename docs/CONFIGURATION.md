# Launch configuration

The debug type is **`altirra-debug`**. Open an ordinary trusted source folder;
there is no special project layout or server to start.

| Field | Purpose |
|---|---|
| `source` | Main ATasm source to assemble. |
| `cwd` | Working directory for the assembler and relative project paths. Defaults to the workspace folder. |
| `includePaths` | Additional ATasm `-I` directories. |
| `defines` | Map of names to values, passed as `-dNAME=VALUE`, without a shell. |
| `assemblerArgs` | Additional ATasm arguments. Do not override the output/list/symbol paths or request raw binary output. |
| `entry` | Optional symbol for the first stop. Otherwise use RUNAD from the XEX. |
| `stopOnEntry` | Stop at entry before running to configured breakpoints; default true in the example. |
| `watchLabels` | Byte expressions shown under Variables → Memory Labels. Other labels work directly in Watch. |
| `hardware` | `800xl` (default), `800`, or `5200`; only the 800XL path is integration-tested. |
| `video` | `pal` (default) or `ntsc`. |
| `kernel` | Altirra `/kernel` value, default `lle`. |
| `altirraPath`, `atasmPath`, `pythonPath` | Tool overrides; otherwise use the extension settings. |
| `winePath`, `winebootPath` | Linux overrides. Ignored by the native Windows path. |
| `program`, `symbols`, `listing` | Existing XEX, ATasm LAB and LST from the exact same build. Omit `source` in this mode. |
| `diskRoot` | Optional MyDOS asset tree; the built XEX replaces AUTORUN.* in a temporary copy. |
| `diskPacker` | External `unix2atr` executable, needed only with `diskRoot`. |
| `diskSectors` | Disk size, default 720 sectors. |

## Existing build task

```json
{
  "type": "altirra-debug",
  "request": "launch",
  "name": "Debug existing build",
  "preLaunchTask": "assemble",
  "program": "${workspaceFolder}/build/game.xex",
  "symbols": "${workspaceFolder}/build/game.lab",
  "listing": "${workspaceFolder}/build/game.lst",
  "cwd": "${workspaceFolder}",
  "stopOnEntry": true
}
```

The extension does not bundle an assembler. ATasm must emit an XEX, symbol table
and source listing. Compiler/task changes after assembly can make addresses stale;
always provide files from one build. `source` takes precedence over `program`.

## MyDOS projects

Programs that load `D1:` assets may need DOS and files before their entry point.
Direct XEX launching does not establish that environment. A disk configuration:

```json
{
  "type": "altirra-debug",
  "request": "launch",
  "name": "Debug game with assets",
  "source": "${workspaceFolder}/game.asm",
  "cwd": "${workspaceFolder}",
  "diskRoot": "${workspaceFolder}/ATR",
  "diskPacker": "${workspaceFolder}/tools/unix2atr",
  "entry": "INIT",
  "stopOnEntry": true
}
```

`diskRoot` must contain compatible DOS boot files (including DOS.SYS) and the asset
subdirectories expected by the game. Supply `unix2atr` separately. The temporary
disk uses virtual writes: the emulator can write to its mounted image, while source
assets remain unchanged. It is rebuilt on the next launch. This is not a cartridge
builder or persistent save-disk manager.

## Emulator storage and isolation

The backend uses `ExtensionContext.globalStorageUri`, under `workspaces/<hash>`
for artifacts/locks and `wine/<hash>` for the Linux Wine prefix. The hash is based
on the workspace path. No Wine prefix is placed inside the indexed source tree;
Wine's `dosdevices/z:` link therefore cannot send VS Code searches into `/`.
The first prefix setup can take time and consume around a gigabyte of disk space.

Only one session per VS Code window and per workspace is allowed. Linux targets
are isolated by Wine prefix; native Windows additionally passes the owned process
ID to the helper. The backend never attaches to a user's ordinary Altirra instance.
The default portable profile disables pause-when-inactive and installs no custom
emulated devices. Emulator/ROM/compiler paths are machine settings, not committed
paths in the repository.
