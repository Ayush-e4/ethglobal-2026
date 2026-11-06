"""Prove one risk score. Reads {"features": [6 numbers 0..1]} on stdin, prints JSON:
{"logit": float, "instances": [hex...], "calldata": "0x...", "ms": {...}}.

Run:  python prove.py <build_dir>  < features.json
The API spawns this; the build dir holds network.ezkl, pk.key, kzg.srs and settings.json.
"""

import asyncio
import inspect
import json
import os
import sys
import tempfile
import time

import ezkl

BUILD = os.path.abspath(sys.argv[1] if len(sys.argv) > 1 else "build")
B = lambda name: os.path.join(BUILD, name)  # noqa: E731


async def run(fn, *a, **k):
    r = fn(*a, **k)
    return await r if inspect.isawaitable(r) else r


async def main() -> None:
    t0 = time.perf_counter()
    features = json.load(sys.stdin)["features"]
    if len(features) != 6 or not all(isinstance(x, (int, float)) and 0 <= x <= 1 for x in features):
        raise SystemExit("features: six numbers between 0 and 1")
    ms: dict[str, int] = {}
    with tempfile.TemporaryDirectory() as tmp:
        T = lambda name: os.path.join(tmp, name)  # noqa: E731
        json.dump({"input_data": [features]}, open(T("input.json"), "w"))
        t = time.perf_counter()
        witness = await run(ezkl.gen_witness, T("input.json"), B("network.ezkl"), T("witness.json"), srs_path=B("kzg.srs"))
        ms["witness"] = round((time.perf_counter() - t) * 1000)
        t = time.perf_counter()
        await run(ezkl.prove, T("witness.json"), B("network.ezkl"), B("pk.key"), T("proof.json"), srs_path=B("kzg.srs"))
        ms["prove"] = round((time.perf_counter() - t) * 1000)
        calldata = await run(ezkl.encode_evm_calldata, T("proof.json"), T("calldata.bin"))
    scale = json.load(open(B("settings.json")))["model_output_scales"][0]
    logit = ezkl.felt_to_float(witness["outputs"][0][0], scale)
    ms["total"] = round((time.perf_counter() - t0) * 1000)
    json.dump({"logit": logit, "scale": scale, "calldata": "0x" + bytes(calldata).hex(), "ms": ms}, sys.stdout)


asyncio.run(main())
