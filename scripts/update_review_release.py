#!/usr/bin/env python3
"""Update only Pulso's already-authorized static copy; retain old hashed assets."""
import hashlib
import json
import os
import re
from pathlib import Path
import tempfile

root = Path(__file__).resolve().parent.parent
source = root / 'dist'
target = root / '.local/review/iphone-v1'
if not target.is_dir() or target.is_symlink():
    raise SystemExit('Expected existing Pulso review directory')
if not (source / 'web.html').is_file() or not (source / 'sw.js').is_file():
    raise SystemExit('Build product first')
pointer = json.loads((source / 'latest.json').read_text())
entry = pointer.get('entry')
if pointer.get('version') != 1 or not isinstance(entry, str) or not re.fullmatch(r'/releases/[a-f0-9]{16}\.html', entry):
    raise SystemExit('Latest pointer mismatch')
entry_path = source / entry.lstrip('/')
if not entry_path.is_file() or entry_path.read_bytes() != (source / 'index.html').read_bytes():
    raise SystemExit('Missing or inconsistent versioned review entry')
if not all((source / name).is_file() for name in ('open.html', 'open.js')):
    raise SystemExit('Missing stable launcher')
files = sorted((p for p in source.rglob('*') if p.is_file()), key=lambda p: (p.suffix == '.html' or p.name in ('sw.js', 'latest.json'), p.name in ('sw.js', 'latest.json'), p.name == 'latest.json', str(p)))
manifest = {}
for path in files:
    if path.is_symlink():
        raise SystemExit('Symlink in build')
    relative = path.relative_to(source)
    destination = target / relative
    destination.parent.mkdir(parents=True, exist_ok=True)
    if not destination.parent.resolve().is_relative_to(target.resolve()) or destination.is_symlink():
        raise SystemExit('Unexpected review path')
    data = path.read_bytes()
    with tempfile.NamedTemporaryFile(dir=destination.parent, prefix='pulso-update-', delete=False) as temporary:
        temporary.write(data)
        temporary.flush()
        os.fsync(temporary.fileno())
        temporary_name = temporary.name
    os.chmod(temporary_name, 0o644)
    os.replace(temporary_name, destination)
    digest = hashlib.sha256(data).hexdigest()
    if hashlib.sha256(destination.read_bytes()).hexdigest() != digest:
        raise SystemExit('Review copy mismatch')
    manifest[str(relative)] = {'bytes': len(data), 'sha256': digest}
(target.parent / 'current-release.json').write_text(json.dumps(manifest, indent=2) + '\n')
if entry.lstrip('/') not in manifest:
    raise SystemExit('Missing versioned review entry')
print(json.dumps({'copiedFiles': len(manifest), 'verified': True, 'retainedOldAssets': True, 'entry': entry}))
