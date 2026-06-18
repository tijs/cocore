#!/usr/bin/env python3
"""End-to-end smoke test for the cocore OpenAI-compatible endpoint.

Usage:
  pip install --user openai
  COCORE_API_KEY=cocore-... ./scripts/openai-e2e.py

Defaults the base URL to https://console.cocore.dev/api/v1; override
with COCORE_BASE_URL for a local console (e.g. http://localhost:3000/api/v1).

The script runs both code paths:
  1. Streaming — prints chunks as they arrive
  2. Non-streaming — buffered JSON, prints content + token usage

Requires at least one attested provider on the configured advisor; the
provider's stub is non-deterministic but produces a short reply.
"""

from __future__ import annotations

import os
import sys

try:
    from openai import OpenAI
except ImportError:
    print("openai not installed. Run: pip install --user openai", file=sys.stderr)
    sys.exit(1)


def main() -> int:
    api_key = os.environ.get("COCORE_API_KEY")
    if not api_key:
        print("COCORE_API_KEY not set. Generate one in /api-keys and export it.", file=sys.stderr)
        return 2

    base_url = os.environ.get("COCORE_BASE_URL", "https://console.cocore.dev/api/v1")
    model = os.environ.get("COCORE_MODEL", "stub")

    print(f"Base URL: {base_url}")
    print(f"Model:    {model}")
    print()

    client = OpenAI(base_url=base_url, api_key=api_key)
    messages = [{"role": "user", "content": "Say hello in three words."}]

    print("--- streaming ---")
    stream = client.chat.completions.create(model=model, messages=messages, stream=True)
    out = ""
    for chunk in stream:
        if not chunk.choices:
            continue
        delta = chunk.choices[0].delta
        text = getattr(delta, "content", None) or ""
        if text:
            out += text
            print(text, end="", flush=True)
    print()
    print(f"(streamed bytes: {len(out)})")
    print()

    print("--- buffered ---")
    resp = client.chat.completions.create(model=model, messages=messages, stream=False)
    print(resp.choices[0].message.content)
    if resp.usage:
        print(
            f"(usage: {resp.usage.prompt_tokens} prompt / "
            f"{resp.usage.completion_tokens} completion)"
        )
    return 0


if __name__ == "__main__":
    sys.exit(main())
