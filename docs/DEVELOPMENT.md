# Development and architecture

The runtime has no npm or pip dependencies. VS Code provides its extension API;
Node and Python standard libraries provide everything else.

```
VS Code debug UI (DAP)
  -> src/adapter.js + editing.js
  -> src/backend.js: owned Python child, JSON lines on stdin/stdout
  -> backend/host.py: build, source map, private storage and session lock
  -> backend/altirra_remote.py + debug_editing.py
  -> backend/native/altirra_ipc.exe
  -> Altirra (WM_COPYDATA commands / directed display events)
```

`src/display.js` is a restricted webview. It requests display-only snapshots,
forwards bounded keyboard events, and never receives a terminal/shell capability.
Both running and paused images use the native display surface. The host converts
the helper's bounded BMP to PNG with `display_frame.py`. There are no running
emulator-side PNG tracepoints. Hidden panels and overlapping requests are skipped.

A real stop invokes a short Altirra script that exports PC/A/X/Y/S/P and CPU-visible
RAM. Source mapping uses the native ATasm listing; only exact instruction addresses
are highlighted. An unmapped PC remains an address, rather than a fabricated line.
Status requests read cached stop data; they do not repeatedly start Wine processes.

Altirra's forwarded command interface appends a resume command. Paused edits must
therefore remain staged in host memory, then be sent before the next explicit
Continue/Step. Do not implement editing by issuing a single forwarded register
command while paused: that would execute the guest. Data breakpoints are similarly
configured at resume time while paused. Only CPU accesses are covered.

The helper's protocol/limits and build instructions are in
[`backend/native/README.md`](../backend/native/README.md).

## Tests

```
python3 scripts/test.py
# or npm test
```

Python tests cover XEX entry detection, private configuration, bounded image decode,
staged edits, access-breakpoint commands and JSON/backend errors. Node tests cover
DAP status/resume races, backend request handling and webview lifecycle behaviour.
They run without an emulator. CI is configured for Linux and Windows; this does
not constitute native-Windows emulator validation.

For real integration, install the prerequisites and run:

```
node tests/integration.js --altirra /path/to/Altirra64.exe
```

Optional arguments: `--atasm /path/to/atasm`, `--storage /temporary/cache/path`.
The test creates a workspace/cache with spaces in the default paths. It checks
source entry, real breakpoints, step, staged register/RAM writes, range watches,
CPU data breakpoints, paused/live images and keyboard input. It needs a graphical
session and a dedicated Wine prefix; Wine's initial setup needs disk space/time.
No original game or framework is used.

## Contributor workflow

Open this repository, run the tests, rebuild the helper if C changes, then package:

```
make -C backend/native
python3 scripts/package.py
```

The helper binary is tracked so a user installing a source checkout does not need
a C toolchain. Changes to the binary must include the corresponding C source.
Do not commit runtime prefixes, caches, private tool paths, emulator binaries,
ROMs, disk images, user configuration or build outputs.

## Validation matrix

- Linux x86-64, Python 3.12, ATasm 1.30, Altirra 4.10 through Wine: local target.
- Windows x64: direct launch, target-PID filtering and portable pipe handling are
  implemented; manual emulator testing on Windows is still required.
- Other Altirra versions, hardware models, firmware choices and input layouts:
  not covered by the local emulator test. Report them separately.

When reporting an issue, include the platform/tool versions, launch configuration
with private paths removed, a small source reproducer and relevant Output-channel
messages. Do not include a whole Wine prefix.
