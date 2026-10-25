"""Build an installable VSIX without npm downloads or third-party Python modules."""
import json
from pathlib import Path
import zipfile

ROOT=Path(__file__).resolve().parents[1]


def package():
    config=json.loads((ROOT/'package.json').read_text())
    helper=ROOT/'backend/native/altirra_ipc.exe'
    if not helper.is_file():raise SystemExit('Build the native helper first: make -C backend/native')
    output=ROOT/'dist'/(config['name']+'-'+config['version']+'.vsix');output.parent.mkdir(exist_ok=True)
    manifest=f'''<?xml version="1.0" encoding="utf-8"?>
<PackageManifest Version="2.0.0" xmlns="http://schemas.microsoft.com/developer/vsx-schema/2011">
<Metadata><Identity Language="en-US" Id="{config['name']}" Version="{config['version']}" Publisher="{config['publisher']}"/>
<DisplayName>{config['displayName']}</DisplayName><Description xml:space="preserve">{config['description']}</Description>
<Properties><Property Id="Microsoft.VisualStudio.Code.Engine" Value="{config['engines']['vscode']}"/></Properties></Metadata>
<Installation><InstallationTarget Id="Microsoft.VisualStudio.Code"/></Installation><Dependencies/>
<Assets><Asset Type="Microsoft.VisualStudio.Code.Manifest" Path="extension/package.json" Addressable="true"/></Assets></PackageManifest>'''
    files=[ROOT/n for n in ('package.json','README.md','CHANGELOG.md','LICENSE','NOTICE.md','language.json','atasm.tmLanguage.json')]
    for directory in ('src','backend','docs','examples'):
        files.extend(p for p in (ROOT/directory).rglob('*') if p.is_file() and '__pycache__' not in p.parts and p.suffix not in ('.pyc','.pyo'))
    with zipfile.ZipFile(output,'w',zipfile.ZIP_DEFLATED) as archive:
        archive.writestr('extension.vsixmanifest',manifest)
        archive.writestr('[Content_Types].xml','<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="json" ContentType="application/json"/><Default Extension="js" ContentType="application/javascript"/><Default Extension="md" ContentType="text/markdown"/><Default Extension="vsixmanifest" ContentType="text/xml"/></Types>')
        for path in sorted(set(files)):
            if path.exists():archive.write(path,'extension/'+path.relative_to(ROOT).as_posix())
    print(output)
    return output


if __name__=='__main__':package()
