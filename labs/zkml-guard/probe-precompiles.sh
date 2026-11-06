#!/usr/bin/env bash
# Does Hedera's EVM have the BN254 precompiles a zk-SNARK verifier needs?
# ecAdd (0x06), ecMul (0x07), ecPairing (0x08) and modexp (0x05), checked with known answers.
set -euo pipefail
RPC="${RPC:-https://testnet.hashio.io/api}"

u() { cast to-uint256 "$1" | sed 's/^0x//'; }

G1="$(u 1)$(u 2)"
# G2 generator, EIP-197 order: x_imag, x_real, y_imag, y_real
G2="$(u 11559732032986387107991004021392285783925812861821192530917403151452391805634)$(u 10857046999023057135944570762232829481370756359578518086990519993285655852781)$(u 4082367875863433681332203403145435568316851327593401208105741076214120093531)$(u 8495653923123431417604973247489272438418190587263600148770280649306958101930)"
# 2*G1, known value
TWO_G="030644e72e131a029b85045b68181585d97816a916871ca8d3c208c16d87cfd315ed738c0e0a7c92e7845f96b2ae9c0a68a6a449e3538fc7ff3ebf7a5a18a2c4"

add=$(cast call 0x0000000000000000000000000000000000000006 --data "0x${G1}${G1}" --rpc-url "$RPC")
echo "ecAdd  G+G == 2G:  $([ "${add#0x}" = "$TWO_G" ] && echo OK || echo "FAIL ($add)")"

mul=$(cast call 0x0000000000000000000000000000000000000007 --data "0x${G1}$(u 2)" --rpc-url "$RPC")
echo "ecMul  G*2 == 2G:  $([ "${mul#0x}" = "$TWO_G" ] && echo OK || echo "FAIL ($mul)")"

# -G1 = (r-1)*G1
neg=$(cast call 0x0000000000000000000000000000000000000007 --data "0x${G1}$(u 21888242871839275222246405745257275088548364400416034343698204186575808495616)" --rpc-url "$RPC")
NEG=${neg#0x}

ok=$(cast call 0x0000000000000000000000000000000000000008 --data "0x${G1}${G2}${NEG}${G2}" --rpc-url "$RPC")
echo "ecPairing e(G,H)e(-G,H) == 1:  $([ "$(cast to-dec "$ok")" = 1 ] && echo OK || echo "FAIL ($ok)")"
bad=$(cast call 0x0000000000000000000000000000000000000008 --data "0x${G1}${G2}${G1}${G2}" --rpc-url "$RPC")
echo "ecPairing e(G,H)e(G,H) == 0:   $([ "$(cast to-dec "$bad")" = 0 ] && echo OK || echo "FAIL ($bad)")"

gas=$(cast rpc eth_estimateGas "{\"to\":\"0x0000000000000000000000000000000000000008\",\"data\":\"0x${G1}${G2}${NEG}${G2}\"}" --rpc-url "$RPC")
echo "ecPairing (2 pairs) gas estimate: $(cast to-dec "${gas//\"/}")"

mx=$(cast call 0x0000000000000000000000000000000000000005 --data "0x$(u 1)$(u 1)$(u 1)030507" --rpc-url "$RPC")
echo "modexp 3^5 mod 7 == 5:  $([ "$(cast to-dec "$mx")" = 5 ] && echo OK || echo "FAIL ($mx)")"
