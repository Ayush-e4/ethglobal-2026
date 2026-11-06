"""How does proving cost grow with the model? Proves one inference for several model sizes.

Run:  python scale.py [out_dir]     (prints one line per model and writes scale.json)
"""

import asyncio
import inspect
import json
import os
import sys
import time

import ezkl
import torch
from torch import nn

OUT = os.path.abspath(sys.argv[1] if len(sys.argv) > 1 else "build/scale")
os.makedirs(OUT, exist_ok=True)
torch.manual_seed(0)


class TinyCNN(nn.Module):  # a 28x28 picture (MNIST-sized), two conv layers
    def __init__(self):
        super().__init__()
        self.net = nn.Sequential(
            nn.Conv2d(1, 4, 3, stride=2), nn.ReLU(), nn.Conv2d(4, 8, 3, stride=2), nn.ReLU(),
            nn.Flatten(), nn.Linear(8 * 6 * 6, 10),
        )

    def forward(self, x):
        return self.net(x)


MODELS = {
    "guard (6-12-8-1, today)": (nn.Sequential(nn.Linear(6, 12), nn.ReLU(), nn.Linear(12, 8), nn.ReLU(), nn.Linear(8, 1)), (1, 6)),
    "wider guard (16-64-64-1)": (nn.Sequential(nn.Linear(16, 64), nn.ReLU(), nn.Linear(64, 64), nn.ReLU(), nn.Linear(64, 1)), (1, 16)),
    "big MLP (32-256-256-1)": (nn.Sequential(nn.Linear(32, 256), nn.ReLU(), nn.Linear(256, 256), nn.ReLU(), nn.Linear(256, 1)), (1, 32)),
    "tiny CNN (28x28 image)": (TinyCNN(), (1, 1, 28, 28)),
}


async def run(fn, *a, **k):
    r = fn(*a, **k)
    return await r if inspect.isawaitable(r) else r


async def one(name, model, shape):
    d = os.path.join(OUT, name.split(" ")[0] + "-" + str(abs(hash(name)) % 1000))
    os.makedirs(d, exist_ok=True)
    P = lambda n: os.path.join(d, n)  # noqa: E731
    x = torch.rand(*shape)
    model.eval()
    torch.onnx.export(model, x, P("m.onnx"), input_names=["input"], output_names=["out"], opset_version=17, dynamo=False)
    json.dump({"input_data": [x.flatten().tolist()]}, open(P("in.json"), "w"))
    json.dump({"input_data": [torch.rand(*shape).flatten().tolist()]}, open(P("cal.json"), "w"))
    params = sum(p.numel() for p in model.parameters())
    args = ezkl.PyRunArgs()
    args.input_visibility, args.output_visibility, args.param_visibility = "public", "public", "fixed"
    await run(ezkl.gen_settings, P("m.onnx"), P("s.json"), py_run_args=args)
    await run(ezkl.calibrate_settings, P("cal.json"), P("m.onnx"), P("s.json"), "resources")
    await run(ezkl.compile_circuit, P("m.onnx"), P("c.ezkl"), P("s.json"))
    await run(ezkl.get_srs, P("s.json"), srs_path=P("k.srs"))
    await run(ezkl.gen_witness, P("in.json"), P("c.ezkl"), P("w.json"), srs_path=P("k.srs"))
    t = time.perf_counter()
    await run(ezkl.setup, P("c.ezkl"), P("vk.key"), P("pk.key"), srs_path=P("k.srs"))
    setup_s = time.perf_counter() - t
    t = time.perf_counter()
    await run(ezkl.prove, P("w.json"), P("c.ezkl"), P("pk.key"), P("p.json"), srs_path=P("k.srs"))
    prove_s = time.perf_counter() - t
    ok = await run(ezkl.verify, P("p.json"), P("s.json"), P("vk.key"), srs_path=P("k.srs"))
    logrows = json.load(open(P("s.json")))["run_args"]["logrows"]
    row = {"model": name, "params": params, "logrows": logrows, "setup_s": round(setup_s, 1),
           "prove_s": round(prove_s, 2), "pk_mb": round(os.path.getsize(P("pk.key")) / 1e6), "verified": ok}
    print(json.dumps(row), flush=True)
    for f in ("pk.key", "k.srs"):  # keep the disk tidy
        os.remove(P(f))
    return row


async def main():
    rows = []
    for name, (model, shape) in MODELS.items():
        try:
            rows.append(await one(name, model, shape))
        except Exception as e:  # noqa: BLE001
            print(json.dumps({"model": name, "error": str(e)[:200]}), flush=True)
    json.dump(rows, open(os.path.join(OUT, "scale.json"), "w"), indent=2)


asyncio.run(main())
