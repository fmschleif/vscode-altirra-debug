"""ATasm source mapping and small, explicit memory expressions for IDE tools."""
import json
from pathlib import Path
import re


def symbols(path):
    result = {}
    for line in Path(path).read_text().splitlines():
        match = re.fullmatch(r'([\da-fA-F]{4})\s+(\S+)', line)
        if match:
            result[match[2].upper()] = int(match[1], 16)
    return result


def address(expression, names):
    # Decimal is unprefixed, hexadecimal uses $ or 0x. No eval/debugger commands.
    match = re.fullmatch(r'\s*([A-Za-z_]\w*|\$[\da-fA-F]+|0x[\da-fA-F]+|\d+)\s*(?:([+-])\s*(\$[\da-fA-F]+|0x[\da-fA-F]+|\d+))?\s*', expression)
    if not match:
        raise ValueError('Use LABEL, LABEL+5, $2000, 0x2000 or decimal 8192')
    def number(token):
        if token.startswith('$'):
            return int(token[1:], 16)
        if token.lower().startswith('0x'):
            return int(token, 16)
        if token.isdecimal():
            return int(token)
        if token.upper() not in names:
            raise ValueError('Unknown label: ' + token)
        return names[token.upper()]
    value = number(match[1])
    if match[2]:
        value += number(match[3]) * (1 if match[2] == '+' else -1)
    return value


def source_path(name, source, includes):
    path = Path(name)
    candidates = [path] if path.is_absolute() else [source.parent/path, *[p/path for p in includes]]
    for candidate in candidates:
        if candidate.is_file():
            return candidate.resolve()
    raise ValueError('Listing source not found: ' + name)


def source_map(listing, source, includes):
    mapping, current = {}, None
    for line in listing.splitlines():
        if line.startswith('Source: '):
            current = source_path(line[8:].strip(), source, includes)
        else:
            match = re.match(r'^(\d+)\s+([\da-fA-F]{4})\s+[\da-fA-F]{2}\b', line)
            if match and current:
                mapping.setdefault((str(current), int(match[1])), set()).add(int(match[2],16))
    return mapping


def breakpoints(path, mapping):
    points = json.loads(Path(path).read_text()) if Path(path).exists() else []
    addresses = set()
    for point in points:
        if not point.get('enabled', True):
            continue
        if any(point.get(k) for k in ('condition', 'hitCondition', 'logMessage')):
            raise ValueError('Only unconditional source breakpoints are supported yet')
        key = (str(Path(point['file']).resolve()), int(point['line']))
        found = mapping.get(key)
        if not found:
            raise ValueError('No assembled bytes on breakpoint %s:%d; choose an instruction line' % key)
        if len(found) != 1:
            raise ValueError('Ambiguous source breakpoint %s:%d (macro/repeated include)' % key)
        addresses.update(found)
    return sorted(addresses)


def memory_request(body, size, names):
    start = address(str(body.get('address','')), names)
    length = body.get('length', 64)
    if not isinstance(length, int) or isinstance(length, bool) or not 1 <= length <= 4096:
        raise ValueError('length must be 1..4096')
    if start < 0 or start + length > size:
        raise ValueError('Memory range out of bounds')
    return start, length
