// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @dev Stands in for Hedera's schedule service (0x16b) in local tests: records what was
///   scheduled; one second can be marked full.
contract MockScheduleService {
    address public lastTo;
    uint256 public lastAt;
    uint256 public lastGas;
    bytes public lastData;
    uint256 public busySecond;

    function setBusy(uint256 second) external {
        busySecond = second;
    }

    function hasScheduleCapacity(uint256 at, uint256) external view returns (bool) {
        return at != busySecond;
    }

    function scheduleCall(address to, uint256 at, uint256 gas, uint64, bytes calldata data)
        external
        returns (int64, address)
    {
        (lastTo, lastAt, lastGas, lastData) = (to, at, gas, data);
        return (22, address(0x5c4ed));
    }
}
