// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract MockUSDT {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    function mint(address to, uint256 n) external { balanceOf[to] += n; }
    function approve(address s, uint256 n) external returns (bool) { allowance[msg.sender][s] = n; return true; }
    function transfer(address to, uint256 n) external virtual returns (bool) { balanceOf[msg.sender] -= n; balanceOf[to] += n; return true; }
    function transferFrom(address f, address to, uint256 n) external virtual returns (bool) {
        allowance[f][msg.sender] -= n; balanceOf[f] -= n; balanceOf[to] += n; return true;
    }
}

/// Takes 1% of every transfer, like some fee-on-transfer tokens.
contract FeeToken is MockUSDT {
    function transferFrom(address f, address to, uint256 n) external override returns (bool) {
        allowance[f][msg.sender] -= n; balanceOf[f] -= n; balanceOf[to] += n - n / 100; return true;
    }
}

/// Calls back into the market in the middle of a transfer, once, and keeps what the market answered.
contract ReentrantToken is MockUSDT {
    address public target;
    bytes public data;
    bool public armed;
    bool public lastOk = true;
    bytes public lastRet;
    function arm(address t, bytes calldata d) external { target = t; data = d; armed = true; }
    function _hit() internal {
        if (armed) {
            armed = false;
            (bool ok, bytes memory r) = target.call(data);
            lastOk = ok;
            lastRet = r;
        }
    }
    function transferFrom(address f, address to, uint256 n) external override returns (bool) {
        _hit();
        allowance[f][msg.sender] -= n; balanceOf[f] -= n; balanceOf[to] += n; return true;
    }
    function transfer(address to, uint256 n) external override returns (bool) {
        _hit();
        balanceOf[msg.sender] -= n; balanceOf[to] += n; return true;
    }
}

/// Like USDT on Ethereum mainnet: transfer and transferFrom return nothing at all.
contract NoReturnToken {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    function mint(address to, uint256 n) external { balanceOf[to] += n; }
    function approve(address s, uint256 n) external { allowance[msg.sender][s] = n; }
    function transfer(address to, uint256 n) external { balanceOf[msg.sender] -= n; balanceOf[to] += n; }
    function transferFrom(address f, address to, uint256 n) external {
        allowance[f][msg.sender] -= n; balanceOf[f] -= n; balanceOf[to] += n;
    }
}

/// A token whose transfer says "false" instead of reverting.
contract FalseToken is MockUSDT {
    function transferFrom(address, address, uint256) external pure override returns (bool) { return false; }
}
