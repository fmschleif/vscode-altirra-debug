# Packaging and publishing

## Distribute a VSIX through GitHub

```
python3 scripts/test.py
make -C backend/native
python3 scripts/package.py
```

Attach `dist/vscode-altirra-debug-0.1.4.vsix` to a GitHub release. Include the source
at the same release tag and platform/tool prerequisites. Users can install the VSIX
through **Extensions → … → Install from VSIX** or the `code` CLI.
The GitHub CI workflow runs portable tests and uploads a packaged VSIX artifact.
It does not publish to the Marketplace or create releases on your behalf.

## VS Code Marketplace (optional, separate step)

The package currently uses local development publisher ID `altirra-debug-local`.
Before Marketplace publishing:

- Register/use your own publisher account and set `package.json.publisher`.
- Verify the `repository`, `homepage` and `bugs` URLs in package.json.
- Review the public description and explicitly retain the Windows-experimental
  status until it has been tested on native Windows.
- Follow Microsoft's current authentication and `vsce` instructions. Do not put
  tokens, credentials or machine-specific settings into this repository.

Official instructions:
[Publishing Extensions](https://code.visualstudio.com/api/working-with-extensions/publishing-extension).

## Source-only archive

The VSIX contains the runtime, helper source/binary, docs and example. A GitHub
source archive additionally includes tests and CI/build scripts. Generated VSIXs,
Wine prefixes and runtime artifacts are excluded from Git. External software is
not bundled: users obtain Altirra, ATasm, Wine and any DOS/assets separately.
