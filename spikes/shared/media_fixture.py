"""Synthetic 8x8 RGB + fictional GPS (0,0); no external Python packages.

The TIFF writer/reader verifies our input GPS. macOS sips, when present, is
only a local encoder/decoder probe, not Cloudflare Images or an iPhone sample.
"""
from pathlib import Path
import hashlib
import json
import shutil
import struct
import subprocess

ROOT = Path(__file__).resolve().parents[1]
FIXTURES = ROOT / 'fixtures'
EVIDENCE = ROOT / 'evidence'
FIXTURES.mkdir(exist_ok=True)
EVIDENCE.mkdir(exist_ok=True)


def create_tiff():
    gps_offset = 8 + 2 + 11 * 12 + 4 + 6
    lat_offset = gps_offset + 2 + 5 * 12 + 4
    lon_offset = lat_offset + 24
    pixels_offset = lon_offset + 24
    entries = [
        (256, 4, 1, 8), (257, 4, 1, 8), (258, 3, 3, gps_offset - 6),
        (259, 3, 1, 1), (262, 3, 1, 2), (273, 4, 1, pixels_offset),
        (277, 3, 1, 3), (278, 4, 1, 8), (279, 4, 1, 192),
        (284, 3, 1, 1), (34853, 4, 1, gps_offset),
    ]
    result = b'II' + struct.pack('<HIH', 42, 8, len(entries))
    for tag, typ, count, value in entries:
        result += struct.pack('<HHII', tag, typ, count, value)
    result += struct.pack('<IHHH', 0, 8, 8, 8)
    result += struct.pack('<H', 5)
    result += struct.pack('<HHI', 0, 1, 4) + bytes([2, 3, 0, 0])
    result += struct.pack('<HHI', 1, 2, 2) + b'N\x00\x00\x00'
    result += struct.pack('<HHII', 2, 5, 3, lat_offset)
    result += struct.pack('<HHI', 3, 2, 2) + b'E\x00\x00\x00'
    result += struct.pack('<HHII', 4, 5, 3, lon_offset)
    result += struct.pack('<I', 0)
    result += struct.pack('<IIIIII', 0, 1, 0, 1, 0, 1) * 2
    result += bytes([60, 120, 90]) * 64
    assert len(result) == pixels_offset + 192
    return result


def gps_in_tiff(data):
    order = '<' if data[:2] == b'II' else '>' if data[:2] == b'MM' else None
    if order is None or len(data) < 8:
        return None
    if struct.unpack_from(order + 'H', data, 2)[0] != 42:
        return None
    offset = struct.unpack_from(order + 'I', data, 4)[0]
    def entries(at):
        count = struct.unpack_from(order + 'H', data, at)[0]
        return [struct.unpack_from(order + 'HHII', data, at + 2 + i * 12) for i in range(count)]
    gps = next((value for tag, typ, count, value in entries(offset) if tag == 34853), None)
    if gps is None:
        return None
    values = {}
    for tag, typ, count, value in entries(gps):
        if tag in (2, 4) and typ == 5 and count == 3:
            fractions = struct.unpack_from(order + 'IIIIII', data, value)
            d, m, s = [fractions[i] / fractions[i + 1] for i in (0, 2, 4)]
            values['latitude' if tag == 2 else 'longitude'] = d + m / 60 + s / 3600
    return values or None


source = FIXTURES / 'synthetic-gps.tiff'
source.write_bytes(create_tiff())
assert gps_in_tiff(source.read_bytes()) == {'latitude': 0.0, 'longitude': 0.0}
report = {'synthetic': True, 'sourceGPS': gps_in_tiff(source.read_bytes()), 'commands': [], 'cloudImages': 'NOT EXECUTED'}
sips = shutil.which('sips')
if not sips:
    report['heicGPSFixture'] = 'BLOCKED: no installed encoder'
else:
    output = FIXTURES / 'synthetic-gps.heic'
    decoded = FIXTURES / 'roundtrip-gps.tiff'
    for command in [
        [sips, '-s', 'format', 'heic', str(source), '--out', str(output)],
        [sips, '-s', 'format', 'tiff', str(output), '--out', str(decoded)],
    ]:
        try:
            run = subprocess.run(command, text=True, capture_output=True, timeout=30)
            report['commands'].append({'argv': command, 'exit': run.returncode, 'stdout': run.stdout, 'stderr': run.stderr})
            if run.returncode != 0:
                break
        except subprocess.TimeoutExpired:
            report['commands'].append({'argv': command, 'error': 'timeout_30s'})
            break
    if output.exists():
        # GPS inspection of raw TIFF payloads is independent of sips metadata reporting.
        raw = output.read_bytes()
        found = []
        for signature in (b'II*\x00', b'MM\x00*'):
            at = raw.find(signature)
            while at >= 0:
                try:
                    gps = gps_in_tiff(raw[at:])
                    if gps:
                        found.append(gps)
                except (struct.error, IndexError, ZeroDivisionError):
                    pass
                at = raw.find(signature, at + 1)
        report['heicGPSPayloads'] = found
        report['heicHeaderHex'] = raw[:32].hex()
        report['heicBytes'] = len(raw)
        report['heicSHA256'] = hashlib.sha256(raw).hexdigest()
    report['roundtripGPS'] = gps_in_tiff(decoded.read_bytes()) if decoded.exists() else None
    report['heicGPSFixture'] = ('LOCAL PASS: encoder/decoder roundtrip and TIFF GPS payload verified'
        if report.get('heicGPSPayloads') and report['roundtripGPS'] == report['sourceGPS']
        else 'BLOCKED: HEIC encoding, decoding or GPS preservation not verified')
(EVIDENCE / 'media-fixture.json').write_text(json.dumps(report, indent=2) + '\n')
print(json.dumps(report, indent=2))
