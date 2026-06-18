"""Print the JSON body for POST /jobs. Reads REQ_PUB, REQUESTER_DID,
SESSION_ID, PROVIDER_DID, CT_ARRAY (a JSON array of byte values) from env."""

import json
import os

print(json.dumps({
    "jobUri": f"at://did:plc:smoke-requester/dev.cocore.compute.job/{os.environ['SESSION_ID']}",
    "requesterDid": os.environ["REQUESTER_DID"],
    "requesterPubKey": os.environ["REQ_PUB"],
    "model": "stub",
    "maxTokensOut": 64,
    "ciphertext": json.loads(os.environ["CT_ARRAY"]),
    "sessionId": os.environ["SESSION_ID"],
    "targetProviderDid": os.environ["PROVIDER_DID"],
}))
