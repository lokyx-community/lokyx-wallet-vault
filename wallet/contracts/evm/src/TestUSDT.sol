// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// A play USDT for testnets ONLY: 18 decimals like USDT on BNB Chain, and anyone can mint to themselves.
/// It is worth nothing. Never use it anywhere real.
contract TestUSDT {
    string public constant name = "Test USDT";
    string public constant symbol = "tUSDT";
    uint8 public constant decimals = 18;
    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    /// Up to 10,000 tUSDT per call, to anyone.
    function mint(address to, uint256 amount) external {
        require(amount <= 10_000e18, "at most 10,000 per mint");
        totalSupply += amount;
        balanceOf[to] += amount;
        emit Transfer(address(0), to, amount);
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        _move(msg.sender, to, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        uint256 a = allowance[from][msg.sender];
        if (a != type(uint256).max) {
            require(a >= amount, "allowance too low");
            allowance[from][msg.sender] = a - amount;
        }
        _move(from, to, amount);
        return true;
    }

    function _move(address from, address to, uint256 amount) internal {
        require(balanceOf[from] >= amount, "balance too low");
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        emit Transfer(from, to, amount);
    }
}
