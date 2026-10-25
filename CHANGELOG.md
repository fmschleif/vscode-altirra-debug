# Changelog

## 0.1.3

Declare tool-path settings with resource scope so the setup wizard can save them
for an individual workspace folder.

## 0.1.2

Add guided tool configuration, workspace-specific tool lookup, pre-launch path
validation and a warning about competing ATasm F5 bindings. Setup cancellation
leaves existing settings unchanged.

## 0.1.1

Fix source breakpoints after stepping, register/RAM edits and data breakpoints
by rebuilding numbered breakpoints without named groups. The combined Altirra
4.10/Wine test covers keyboard input and repeated Select presses in this sequence.

## 0.1.0

Initial developer release of the Altirra debugger for VS Code.
Includes staged register/RAM editing, ranges, access breakpoints, native display
capture, directed keyboard input, configurable tool paths and an example program.
