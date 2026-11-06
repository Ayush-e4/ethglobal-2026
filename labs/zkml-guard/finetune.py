"""Can we retrain or fine-tune the model without deploying a new verifier?

Weights "fixed" (build.py): the weights are baked into the keys, so new weights need new keys
and a new verifier contract. Weights "hashed" (here): the weights are a private input and the
proof shows a hash of them, so the same keys and verifier work for any weights of the same
shape, and an on-chain list of approved hashes says which models count.

Run:  python finetune.py [out_dir]
"""

import asyncio
import inspect
import json
import os
import sys

import ezkl
import numpy as np
import torch
from torch import nn

OUT = os.path.abspath(sys.argv[1] if len(sys.argv) > 1 else "build/finetune")
os.makedirs(OUT, exist_ok=True)
P = lambda n: os.path.join(OUT, n)  # noqa: E731
torch.manual_seed(7)
rng = np.random.default_rng(7)


def data(dispute_weight: float, n: int = 6000):
    x = rng.random((n, 6)).astype(np.float32)
    x[:, 3] = (x[:, 3] > 0.6).astype(np.float32)
    a, s, b, nw, t, d = x.T
    z = 3.0 * a + 2.0 * s + 3.5 * b + 1.2 * nw - 2.5 * t + dispute_weight * d - 2.2
    return torch.tensor(x), torch.tensor((z > 0).astype(np.float32)).unsqueeze(1)


def train(model, x, y, steps):
    opt = torch.optim.Adam(model.parameters(), lr=0.01)
    for _ in range(steps):
        opt.zero_grad()
        nn.functional.binary_cross_entropy_with_logits(model(x), y).backward()
        opt.step()
    return ((model(x) > 0).float() == y).float().mean().item()


async def run(fn, *a, **k):
    r = fn(*a, **k)
    return await r if inspect.isawaitable(r) else r


async def main():
    model = nn.Sequential(nn.Linear(6, 12), nn.ReLU(), nn.Linear(12, 8), nn.ReLU(), nn.Linear(8, 1))
    acc_a = train(model, *data(3.0), 400)
    sample = torch.tensor([[0.3, 0.3, 0.1, 1.0, 0.6, 0.5]])  # a payee with open disputes
    model.eval()
    torch.onnx.export(model, sample, P("a.onnx"), input_names=["input"], output_names=["risk_logit"], opset_version=17, dynamo=False)
    logit_a = model(sample).item()

    # Fine-tune: disputes now count for much more (as if real reports showed they matter).
    model.train()
    acc_b = train(model, *data(8.0), 150)
    model.eval()
    torch.onnx.export(model, sample, P("b.onnx"), input_names=["input"], output_names=["risk_logit"], opset_version=17, dynamo=False)
    logit_b = model(sample).item()
    print(f"model A: accuracy {acc_a:.3f}, sample logit {logit_a:.3f}")
    print(f"model B (fine-tuned): accuracy {acc_b:.3f} on the new rule, sample logit {logit_b:.3f}")

    json.dump({"input_data": [sample.flatten().tolist()]}, open(P("in.json"), "w"))
    json.dump({"input_data": [rng.random((40, 6)).astype(np.float32).flatten().tolist()]}, open(P("cal.json"), "w"))

    args = ezkl.PyRunArgs()
    args.input_visibility, args.output_visibility, args.param_visibility = "public", "public", "hashed"
    await run(ezkl.gen_settings, P("a.onnx"), P("s.json"), py_run_args=args)
    await run(ezkl.calibrate_settings, P("cal.json"), P("a.onnx"), P("s.json"), "resources")
    await run(ezkl.get_srs, P("s.json"), srs_path=P("k.srs"))

    # Keys made once, from model A.
    await run(ezkl.compile_circuit, P("a.onnx"), P("a.ezkl"), P("s.json"))
    await run(ezkl.setup, P("a.ezkl"), P("vk.key"), P("pk.key"), srs_path=P("k.srs"))
    print("logrows", json.load(open(P("s.json")))["run_args"]["logrows"], "pk MB", round(os.path.getsize(P("pk.key")) / 1e6))

    results = {}
    for tag in ("a", "b"):
        if tag == "b":
            await run(ezkl.compile_circuit, P("b.onnx"), P("b.ezkl"), P("s.json"))  # same settings, new weights
        w = await run(ezkl.gen_witness, P("in.json"), P(f"{tag}.ezkl"), P(f"w{tag}.json"), srs_path=P("k.srs"))
        await run(ezkl.prove, P(f"w{tag}.json"), P(f"{tag}.ezkl"), P("pk.key"), P(f"p{tag}.json"), srs_path=P("k.srs"))
        ok = await run(ezkl.verify, P(f"p{tag}.json"), P("s.json"), P("vk.key"), srs_path=P("k.srs"))
        scale = json.load(open(P("s.json")))["model_output_scales"][0]
        proved = ezkl.felt_to_float(w["outputs"][0][0], scale)
        model_hash = [h for h in w.get("processed_params", {}).get("poseidon_hash", [])] if isinstance(w.get("processed_params"), dict) else None
        results[tag] = {"verified_with_model_A_keys": ok, "proved_logit": round(proved, 3), "weights_hash": model_hash}
        print(tag, json.dumps(results[tag])[:200])
    same_hash = results["a"]["weights_hash"] == results["b"]["weights_hash"]
    print("weights hash differs between A and B:", not same_hash)


asyncio.run(main())
