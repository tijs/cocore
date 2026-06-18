"""Pick the freshest attested provider from advisor /providers JSON
on stdin and print its full record on stdout."""

import json
import sys

ps = json.load(sys.stdin)
ps = [p for p in ps if p.get("attestedAt")]
if not ps:
    sys.exit("no attested providers")
ps.sort(key=lambda p: p["lastSeen"], reverse=True)
print(json.dumps(ps[0]))
