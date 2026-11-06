"""zkML spend guard, lab: train a tiny risk model, then prove one inference with EZKL.

Run:  python build.py [out_dir]
Writes into out_dir (default ./build): model.onnx, settings.json, network.ezkl, vk.key, pk.key,
proof.json, Verifier.sol, and timings.json.
"""

import asyncio
import inspect
import json
import os
import sys
import time

import ezkl
import numpy as np
import torch
from torch import nn

OUT = os.path.abspath(sys.argv[1] if len(sys.argv) > 1 else "build")
os.makedirs(OUT, exist_ok=True)
P = lambda name: os.path.join(OUT, name)  # noqa: E731

# The six facts the guard looks at, all scaled to 0..1 by the API before scoring.
FEATURES = [
    "amount_vs_cap",      # this payment / the limit's per-payment cap
    "spent_vs_budget",    # already spent / the limit's budget, after this payment
    "burst",              # payments in the last 10 minutes / 10
    "new_payee",          # 1 if the AI never paid this payee before
    "payee_trust",        # the payee's verified rating (0 bad .. 1 good), 0.5 if none
    "disputes",           # the payee's open disputes / 5
]

torch.manual_seed(7)
rng = np.random.default_rng(7)


def label(x: np.ndarray) -> np.ndarray:
    """The behaviour we want the model to learn (a teacher rule plus noise)."""
    a, s, b, n, t, d = x.T
    z = 3.0 * a + 2.0 * s + 3.5 * b + 1.2 * n - 2.5 * t + 3.0 * d - 2.2
    z += rng.normal(0, 0.4, size=z.shape)
    return (1 / (1 + np.exp(-z)) > 0.5).astype(np.float32)


X = rng.random((6000, len(FEATURES))).astype(np.float32)
X[:, 3] = (X[:, 3] > 0.6).astype(np.float32)  # new_payee is 0 or 1
Y = label(X)

model = nn.Sequential(nn.Linear(6, 12), nn.ReLU(), nn.Linear(12, 8), nn.ReLU(), nn.Linear(8, 1))  # outputs a logit: no sigmoid in the circuit
opt = torch.optim.Adam(model.parameters(), lr=0.01)
xt, yt = torch.tensor(X), torch.tensor(Y).unsqueeze(1)
for _ in range(400):
    opt.zero_grad()
    loss = nn.functional.binary_cross_entropy_with_logits(model(xt), yt)
    loss.backward()
    opt.step()
acc = ((model(xt) > 0).float() == yt).float().mean().item()
print(f"trained: loss {loss.item():.3f}, accuracy {acc:.3f}")

# One payment to prove: fairly big, to a new payee with middling trust (a borderline case).
sample = np.array([[0.5, 0.35, 0.2, 1.0, 0.55, 0.1]], dtype=np.float32)
with torch.no_grad():
    plain = model(torch.tensor(sample)).item()
print(f"plain PyTorch risk logit for the sample: {plain:.4f} (p = {1 / (1 + np.exp(-plain)):.3f})")

model.eval()
torch.onnx.export(
    model, torch.tensor(sample), P("model.onnx"),
    input_names=["input"], output_names=["risk_logit"], opset_version=17, dynamo=False,
)
json.dump({"input_data": [sample.flatten().tolist()]}, open(P("input.json"), "w"))
cal = rng.random((40, len(FEATURES))).astype(np.float32)
json.dump({"input_data": [cal.flatten().tolist()]}, open(P("calibration.json"), "w"))

timings: dict[str, float] = {}


def timed(name, fn, *a, **k):
    async def call():  # some EZKL calls need a running event loop, some return coroutines
        r = fn(*a, **k)
        return await r if inspect.isawaitable(r) else r

    t = time.perf_counter()
    r = asyncio.run(call())
    timings[name] = round(time.perf_counter() - t, 3)
    print(f"{name:<22} {timings[name]:>8.3f} s  -> {str(r)[:60]}")
    return r


args = ezkl.PyRunArgs()
args.input_visibility = "public"   # the payment's facts: anyone can check them
args.output_visibility = "public"  # the risk score (a logit: above 0 means more likely risky)
args.param_visibility = "fixed"    # the weights are baked into the circuit: the key IS the model

timed("gen_settings", ezkl.gen_settings, P("model.onnx"), P("settings.json"), py_run_args=args)
timed("calibrate_settings", ezkl.calibrate_settings, P("calibration.json"), P("model.onnx"), P("settings.json"), "resources")
timed("compile_circuit", ezkl.compile_circuit, P("model.onnx"), P("network.ezkl"), P("settings.json"))
timed("get_srs", ezkl.get_srs, P("settings.json"), srs_path=P("kzg.srs"))
timed("gen_witness", ezkl.gen_witness, P("input.json"), P("network.ezkl"), P("witness.json"), srs_path=P("kzg.srs"))
timed("setup", ezkl.setup, P("network.ezkl"), P("vk.key"), P("pk.key"), srs_path=P("kzg.srs"))
timed("prove", ezkl.prove, P("witness.json"), P("network.ezkl"), P("pk.key"), P("proof.json"), srs_path=P("kzg.srs"))
timed("verify", ezkl.verify, P("proof.json"), P("settings.json"), P("vk.key"), srs_path=P("kzg.srs"))

settings = json.load(open(P("settings.json")))
witness = json.load(open(P("witness.json")))
out_scale = settings["model_output_scales"][0]
proved = ezkl.felt_to_float(witness["outputs"][0][0], out_scale)
print(f"logrows {settings['run_args']['logrows']}, output scale {out_scale}")
print(f"proved logit {proved:.4f} vs plain {plain:.4f}")

try:
    timed("create_evm_verifier", ezkl.create_evm_verifier, P("vk.key"), P("settings.json"), P("Verifier.sol"), P("Verifier.abi"), srs_path=P("kzg.srs"))
except Exception as e:  # noqa: BLE001
    print("create_evm_verifier failed:", e)

try:
    timed("encode_evm_calldata", ezkl.encode_evm_calldata, P("proof.json"), P("calldata.bin"))
except Exception as e:  # noqa: BLE001
    print("encode_evm_calldata failed:", e)

sizes = {n: os.path.getsize(P(n)) for n in ["pk.key", "vk.key", "proof.json", "kzg.srs"] if os.path.exists(P(n))}
json.dump({"timings_s": timings, "sizes_bytes": sizes, "accuracy": acc, "plain": plain, "proved": proved},
          open(P("timings.json"), "w"), indent=2)
print("sizes:", sizes)
