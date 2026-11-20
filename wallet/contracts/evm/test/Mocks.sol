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

/// ERC-1155 receivers used to test transfers into contracts.
interface IMarketLike {
    function safeTransferFrom(address from, address to, uint256 id, uint256 value, bytes calldata data) external;
    function deposit(uint256 amount) external;
    function withdraw(uint256 amount) external;
}

contract GoodReceiver {
    uint256 public received;
    function onERC1155Received(address, address, uint256, uint256 v, bytes calldata) external returns (bytes4) {
        received += v;
        return this.onERC1155Received.selector;
    }
    function onERC1155BatchReceived(address, address, uint256[] calldata, uint256[] calldata v, bytes calldata) external returns (bytes4) {
        for (uint256 i = 0; i < v.length; i++) received += v[i];
        return this.onERC1155BatchReceived.selector;
    }
}

contract WrongAnswerReceiver {
    function onERC1155Received(address, address, uint256, uint256, bytes calldata) external pure returns (bytes4) { return 0xdeadbeef; }
    function onERC1155BatchReceived(address, address, uint256[] calldata, uint256[] calldata, bytes calldata) external pure returns (bytes4) { return 0xdeadbeef; }
}

contract RevertingReceiver {
    function onERC1155Received(address, address, uint256, uint256, bytes calldata) external pure returns (bytes4) { revert("no thanks"); }
    function onERC1155BatchReceived(address, address, uint256[] calldata, uint256[] calldata, bytes calldata) external pure returns (bytes4) { revert("no thanks"); }
}

/// Tries to use the market again from inside the callback; every attempt must be refused.
contract ReentrantReceiver {
    IMarketLike public market;
    bool public triedAndFailed;
    constructor(address m) { market = IMarketLike(m); }
    function onERC1155Received(address, address, uint256 id, uint256, bytes calldata) external returns (bytes4) {
        try market.safeTransferFrom(address(this), address(0xBEEF), id, 1, "") { triedAndFailed = false; } catch { triedAndFailed = true; }
        return this.onERC1155Received.selector;
    }
    function onERC1155BatchReceived(address, address, uint256[] calldata, uint256[] calldata, bytes calldata) external pure returns (bytes4) {
        return this.onERC1155BatchReceived.selector;
    }
}
