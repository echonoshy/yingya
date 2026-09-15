#!/usr/bin/env python3
"""Summarize host relay metadata; never read auth or project conversations."""
import argparse
from collections import Counter, defaultdict
import json
from pathlib import Path
import time


def summarize(root, hours):
    groups = defaultdict(list)
    malformed = 0
    cutoff = time.time() * 1000 - hours * 3600 * 1000
    for path in sorted(root.glob('requests*.jsonl')):
        for line in path.read_text().splitlines():
            try:
                row = json.loads(line)
            except ValueError:
                malformed += 1
                continue
            if row.get('created_at_ms', 0) >= cutoff:
                groups[(row.get('account_model'), row.get('model'), row.get('requested_tier'))].append(row)
    result = []
    for (account_model, model, tier), rows in groups.items():
        timing = {}
        for field in ('queue_ms', 'headers_ms', 'first_byte_ms', 'total_ms'):
            values = sorted(row[field] for row in rows if isinstance(row.get(field), (int, float)))
            if values:
                timing[field] = {'p50': values[(len(values)-1)//2], 'p95': values[min(len(values)-1, (95*len(values)+99)//100-1)]}
        fingerprints = Counter(row['request_fingerprint'] for row in rows if row.get('request_fingerprint'))
        result.append({'account_model': account_model, 'model': model, 'requested_tier': tier,
                       'requests': len(rows), 'outcomes': dict(Counter(row.get('outcome') for row in rows)),
                       'error_codes': dict(Counter(row['error_code'] for row in rows if row.get('error_code'))),
                       'actual_tiers': dict(Counter(row['actual_tier'] for row in rows if row.get('actual_tier'))),
                       'repeated_payloads': sum(count-1 for count in fingerprints.values()), 'timing_ms': timing})
    return {'hours': hours, 'malformed_lines': malformed, 'groups': result}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, default=Path(__file__).resolve().parents[1] / '.runtime/codex-home/model-relay')
    parser.add_argument('--hours', type=float, default=24)
    args = parser.parse_args()
    if args.hours <= 0:
        parser.error('--hours must be positive')
    print(json.dumps(summarize(args.root, args.hours), ensure_ascii=False, indent=2))
