"""Publish a validated upload; latest.json is the final atomic commit point."""
import fcntl
import grp
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import sys
import tempfile

ROOT = Path('/var/www/updates/apps/codexapp')


def publish(stage, expected_hash):
    if not re.fullmatch(r'/tmp/codexapp-release-[0-9a-f]{32}', str(stage)):
        raise ValueError('Invalid staging directory')
    manifest = json.loads((stage / 'latest.json').read_text(encoding='utf-8'))
    code = manifest['versionCode']
    if type(code) is not int or code <= 0:
        raise ValueError('Invalid version code')
    if manifest['appId'] != 'codexapp' or manifest['packageName'] != 'com.anonymous.mobile':
        raise ValueError('Invalid application identity')
    if not re.fullmatch(r'\d+\.\d+\.\d+', manifest['versionName']):
        raise ValueError('Invalid version name')
    name = f"codexapp-v{manifest['versionName']}-{code}.apk"
    if manifest['apkUrl'] != f'https://updates.yinxingye.space/apps/codexapp/apk/{name}':
        raise ValueError('Invalid APK URL')
    apk = stage / name
    digest = hashlib.sha256(apk.read_bytes()).hexdigest()
    if digest != manifest['sha256'] or apk.stat().st_size != manifest['fileSize']:
        raise ValueError('Uploaded APK hash or size mismatch')
    group = grp.getgrnam('www-data').gr_gid
    # Serialize publishers and recheck the baseline after upload/build time.
    with (ROOT / '.publish.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        current = json.loads((ROOT / 'latest.json').read_text(encoding='utf-8'))
        if current['sha256'] != expected_hash or code <= current['versionCode']:
            raise ValueError('Server version changed or version code is not increasing')
        version_path = ROOT / 'versions' / f'{code}.json'
        apk_path = ROOT / 'apk' / name
        if version_path.exists() or apk_path.exists():
            raise ValueError('Release files already exist; inspect unfinished publication before retrying')
        staged_files = []
        try:
            for source, destination in ((apk, apk_path), (stage / 'latest.json', version_path), (stage / 'latest.json', ROOT / 'latest.json')):
                fd, temporary = tempfile.mkstemp(prefix='.release-', dir=destination.parent)
                staged_files.append(Path(temporary))
                with os.fdopen(fd, 'wb') as target, source.open('rb') as incoming:
                    shutil.copyfileobj(incoming, target)
                    target.flush()
                    os.fsync(target.fileno())
                os.chown(temporary, 0, group)
                os.chmod(temporary, 0o640)
            # Immutable artifacts first; never overwrite release history.
            os.link(staged_files[0], apk_path)
            os.link(staged_files[1], version_path)
            os.replace(staged_files[2], ROOT / 'latest.json')
        finally:
            for temporary in staged_files:
                temporary.unlink(missing_ok=True)
    print(f'Published versionCode={code}, sha256={digest}')


if __name__ == '__main__':
    publish(Path(sys.argv[1]), sys.argv[2])