// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

/// Hash-locked swap for a chain's native coin (ETH, BNB, POL, LYX...). The other half of a swap
/// with LOKYX: same sha256 hashlock, same 32-byte secret.
///
/// lock:   the sender locks msg.value for `recipient` until `refundTime`
/// claim:  anyone can send it to the recipient by revealing the secret, before refundTime
/// refund: anyone can send it back to the sender, from refundTime on
contract LokyxSwap {
    struct Lock {
        address sender;
        address recipient;
        uint256 amount;
        bytes32 hashlock;
        uint64 refundTime;
    }

    mapping(bytes32 => Lock) public locks;

    event Locked(
        bytes32 indexed id,
        bytes32 indexed hashlock,
        address indexed recipient,
        address sender,
        uint256 amount,
        uint64 refundTime
    );
    event Claimed(bytes32 indexed id, bytes32 secret);
    event Refunded(bytes32 indexed id);

    error InvalidLock();
    error NoSuchLock();
    error WrongSecret();
    error TooLate();
    error TooEarly();
    error TransferFailed();

    function lock(bytes32 hashlock, address recipient, uint64 refundTime) external payable returns (bytes32 id) {
        if (msg.value == 0 || recipient == address(0)) revert InvalidLock();
        if (refundTime <= block.timestamp || refundTime > block.timestamp + 30 days) revert InvalidLock();
        id = keccak256(abi.encode(msg.sender, recipient, hashlock, refundTime, msg.value));
        if (locks[id].amount != 0) revert InvalidLock();
        locks[id] = Lock(msg.sender, recipient, msg.value, hashlock, refundTime);
        emit Locked(id, hashlock, recipient, msg.sender, msg.value, refundTime);
    }

    function claim(bytes32 id, bytes32 secret) external {
        Lock memory l = locks[id];
        if (l.amount == 0) revert NoSuchLock();
        if (block.timestamp >= l.refundTime) revert TooLate();
        if (sha256(abi.encodePacked(secret)) != l.hashlock) revert WrongSecret();
        delete locks[id];
        emit Claimed(id, secret);
        (bool ok,) = l.recipient.call{value: l.amount}("");
        if (!ok) revert TransferFailed();
    }

    function refund(bytes32 id) external {
        Lock memory l = locks[id];
        if (l.amount == 0) revert NoSuchLock();
        if (block.timestamp < l.refundTime) revert TooEarly();
        delete locks[id];
        emit Refunded(id);
        (bool ok,) = l.sender.call{value: l.amount}("");
        if (!ok) revert TransferFailed();
    }
}
