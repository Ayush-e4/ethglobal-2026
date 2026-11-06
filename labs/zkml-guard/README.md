# Lab: zkML spend guard

**Question:** can a small neural network score each AI payment for risk, with a zero-knowledge
proof that the score really came from *our published model*, checked on Hedera? **Answer: yes.**
This lab is the feasibility check. Nothing in the app uses it yet.

Web2 analogy: a fraud score from Stripe Radar, except anyone can check the score wasn't made up,
skipped, or computed with a different model, without trusting us.

## The idea

1. Before the AI pays, the API turns the payment into six numbers (0..1): amount vs the limit's
   cap, budget used, payments in the last 10 minutes, new payee, the payee's verified rating, its
   open disputes.
2. A tiny network (6 → 12 → 8 → 1, ReLU) gives a **risk score** (a logit: above 0 means more
   likely risky).
3. EZKL proves "this model, on these six numbers, gives this score". The model's weights are
   **fixed** into the circuit (`param_visibility = "fixed"`), so the verifier key *is* the model:
   a proof made with any other weights fails.
4. A verifier contract on Hedera checks the proof. Low risk: pay as today. High risk: ask for the
   person's World ID approval first.

## What was checked (7 Nov 2026)

| Check | Result |
|---|---|
| Hedera EVM has the BN254 precompiles a SNARK verifier needs (`probe-precompiles.sh`) | ecAdd, ecMul, ecPairing, modexp all give the known answers on testnet |
| EZKL 23.0.5 installs on macOS arm64 (Python 3.12) and proves the model | Yes |
| The proved score matches plain PyTorch | 4.4406 vs 4.4430 (fixed-point rounding) |
| Proving time | **0.79 s** in process; **0.73 s** for a cold `prove.py` run, so the API can spawn it |
| Verifying off chain | 8 ms |
| Verifier contract fits Hedera's 24 KB limit | 13,430 bytes |
| Verify on Hedera testnet: real proof | **Accepted**, ≈ 591k gas ([0.0.11344909](https://hashscan.io/testnet/contract/0.0.11344909)) |
| Same proof, score lowered by one step | **Rejected** |
| Same proof, payment amount changed | **Rejected** |
| Runs like the VM (Docker `python:3.12-alpine`, linux/arm64, 2 CPUs): EZKL's only ARM64 Linux wheel is musl, so Alpine, not Debian or Ubuntu | **2.0 s** a proof, **340 MB** peak; its proof is accepted on Hedera too |
| Proving key size | 138 MB (logrows 15). With a sigmoid in the circuit it was 654 MB and 3.1 s, so the circuit outputs the logit and the UI applies the sigmoid |

The model is trained on a synthetic "teacher" rule (97.8% agreement). It's a demo model, not a
real fraud model: the point is the pipeline.

## Bigger models (`scale.py`, on a Mac; the 2-core VM is about 2.5× slower)

| Model | Parameters | logrows | Prove | Proving key |
|---|---|---|---|---|
| Guard, today (6-12-8-1) | 197 | 15 | 0.68 s | 138 MB |
| Wider guard (16-64-64-1) | 5,313 | 15 | 0.72 s | 138 MB |
| Big MLP (32-256-256-1) | 74,497 | 16 | 1.6 s | 277 MB |
| Tiny CNN (28×28 image) | 3,226 | 16 | 1.7 s | 277 MB |

Anything that exports to ONNX works the same way. Cost grows with the number of operations,
roughly doubling per logrow. Models up to ~100k parameters are fine for a live demo; LLMs (billions
of parameters) are far out of reach for EZKL on this hardware.

## Retraining and fine-tuning (`finetune.py`)

Two ways to tie a proof to a model:

| Weights | What the proof shows | Change the model | Proving key |
|---|---|---|---|
| `fixed` (`build.py`, deployed now) | "this exact model" (the weights are in the keys) | New keys and a new verifier contract | 138 MB |
| `hashed` (`finetune.py`) | "a model whose weights hash to H" (H is the first public value) | Same keys and verifier; approve the new H on chain | 329 MB |

Checked: model A trained, keys made from A; then fine-tuned to model B (disputes count for much
more: the sample's logit went from 8.5 to 31.2). B's proof, made with A's keys, **verifies with
A's verification key**, and its weights hash is different (`ca666d10…` vs `9a6633ce…`). So with
`hashed`, the verifier stays and a list of approved model hashes says which models count. The
model's shape (layers and sizes) must stay the same; a new shape needs new keys.

## Files

| File | What |
|---|---|
| `build.py` | Trains the model, exports ONNX, runs EZKL (settings, calibrate, compile, SRS, keys, prove, verify), writes the Solidity verifier and timings |
| `prove.py` | One proof: six numbers on stdin → score and EVM calldata on stdout (what the API would spawn) |
| `probe-precompiles.sh` | Checks Hedera's BN254 and modexp precompiles with known answers |
| `evm/src/RiskVerifier.sol` | The generated verifier for `artifacts/model.onnx` |
| `artifacts/` | The model, its settings, a sample proof's calldata and the timings (the keys are rebuilt by `build.py`; `*.key` stays out of git) |
| `../../packages/mandates/scripts/risk-verifier-check.ts` | Deploys the verifier and checks the real and two forged proofs on testnet |

## Run it

```bash
uv venv -p 3.12 .venv && uv pip install --python .venv ezkl torch onnx numpy
.venv/bin/python build.py build        # ~40 s the first time (downloads the public SRS)
bash probe-precompiles.sh
forge build --root evm --sizes
pnpm --filter @app/mandates exec tsx --env-file=../../.env scripts/risk-verifier-check.ts \
  ../../labs/zkml-guard/artifacts/calldata.bin
```

`build.py` retrains the model. Retraining can change the weights, and then the verifier must be
redeployed: the committed verifier matches `artifacts/model.onnx`.

## Who controls what

| Who | Can | Can't |
|---|---|---|
| Operator (deployed the verifier) | Nothing after deploying: the verifier has no owner, no admin, no storage | Change the model it accepts |
| Our API (would make the proofs) | Choose the six numbers it feeds in, which are public in the proof | Claim a score the model didn't give, or use other weights |
| Anyone | Re-check any proof against the verifier | |

The six numbers are public, so anyone can check they match the payment. Making the contract
itself recompute them from the mandate is the next step.

## Next, to use it in the app

1. Serve `prove.py` behind the API (or a small prover container next to it on the VM).
2. The hire flow sends the payment's six numbers, gets the score and proof, and asks for World ID
   above a threshold.
3. Put the proof's hash and the verifier's answer on the Arkiv receipt, and record the result in
   the ERC-8004 validation registry.
4. Optionally make `MandateRegistry` call the verifier for payments above a size.
