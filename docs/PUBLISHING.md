# Put this project in your GitHub repository

This folder is an independent repository candidate. It does not need anything
from the original AtariVMem checkout. A local source folder/VSIX does not create
a GitHub repository or publish an extension automatically.

1. Create an empty repository named `vscode-altirra-debug` under your account.
2. Review LICENSE, NOTICE, the package name and the support matrix.
3. From this folder, initialize Git if needed and push to your repository:

```sh
git init -b main
git add .
git commit -m "Initial standalone Altirra debugger"
git remote add origin https://github.com/YOUR_USER/vscode-altirra-debug.git
git push -u origin main
```

If a local `.git` already exists, skip `git init`. If `origin` already exists,
inspect it before changing it. Repository names are unique within an account;
using this name here does not reserve a Marketplace extension/publisher identity.

## Distribute a VSIX through GitHub

```
python3 scripts/test.py
make -C backend/native
python3 scripts/package.py
```

Attach `dist/vscode-altirra-debug-0.1.0.vsix` to a GitHub release. Include the source
at the same release tag and platform/tool prerequisites. Users can install the VSIX
through **Extensions → … → Install from VSIX** or the `code` CLI.
The GitHub CI workflow runs portable tests and uploads a packaged VSIX artifact.
It does not publish to the Marketplace or create releases on your behalf.

## VS Code Marketplace (optional, separate step)

The package currently uses local development publisher ID `altirra-debug-local`.
Before Marketplace publishing:

- Register/use your own publisher account and set `package.json.publisher`.
- Add your actual `repository`, `homepage` and `bugs` URLs to package.json.
- Review the public description and explicitly retain the Windows-experimental
  status until it has been tested on native Windows.
- Follow Microsoft's current authentication and `vsce` instructions. Do not put
  tokens, credentials or machine-specific settings into this repository.

Official instructions:
[Publishing Extensions](https://code.visualstudio.com/api/working-with-extensions/publishing-extension).
An account-specific Marketplace identity and a GitHub repository are different
things. The standalone debug type `altirra-debug` is distinct from the former
local `atarivmem` integration, so both can be installed during migration.

## Source-only archive

The VSIX contains the runtime, helper source/binary, docs and example. A GitHub
source archive additionally includes tests and CI/build scripts. Generated VSIXs,
Wine prefixes and runtime artifacts are excluded from Git. External software is
not bundled: users obtain Altirra, ATasm, Wine and any DOS/assets separately.
