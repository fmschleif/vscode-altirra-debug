CC = x86_64-w64-mingw32-gcc
CFLAGS = -Os -Wall -Wextra -static-libgcc -s

altirra_ipc.exe: altirra_ipc.c
	$(CC) $(CFLAGS) $< -o $@ -lgdi32
