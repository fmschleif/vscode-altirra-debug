# Native helper

`altirra_ipc.exe` is a small Windows x64 program, used through Wine on Linux or
started directly on native Windows. Its GPL-3.0-only source is `altirra_ipc.c`.

Rebuild on Linux with MinGW-w64:

```
make -C backend/native
```

Dependencies are standard Windows DLLs: KERNEL32, USER32, GDI32 and MSVCRT. No
Windows Python/.NET runtime is required. The shipped binary is built with `-Os
-Wall -Wextra -static-libgcc -s` and `-lgdi32`; CI rebuilds it from source.

The helper reads bounded binary requests from stdin and returns uint32 statuses.
It finds AltirraMainWindow only in its Wine namespace; on native Windows the
`--target-pid` argument additionally restricts it to the child emulator's PID.
It refuses absent or ambiguous targets. No desktop capture, SetForegroundWindow,
SendInput or global keyboard hooks are used.

Startup reply: 0x31425049. Standard request: length prefix, Altirra GUID and UTF-16
command-line/property payload. UI request: 20 bytes consisting of five uint32s:
0x49555641, operation, VK, character, flags. Operations: 1 display surface capture,
2 key event (flag 1 down, flag 2 repeat), 3 release held keys. Capture reads only
`phaeronVideoDisplay`, caps dimensions to 672×480, and atomically replaces a BMP
in the private session directory. Host Python performs PNG encoding.

All request lengths, capture dimensions and delivery waits are bounded. Sending
a debugger command can resume the guest, so register/RAM edits are staged until
an explicit step/Continue. UI capture/key messages do not submit debugger commands.
