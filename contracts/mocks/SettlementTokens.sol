// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract SettlementToken is ERC20 {
    constructor() ERC20("Settlement Token", "SET") {}

    function mint(address recipient, uint256 amount) external {
        _mint(recipient, amount);
    }
}

contract FeeSettlementToken is SettlementToken {
    function _update(address from, address to, uint256 value) internal override {
        if (from != address(0) && to != address(0)) {
            uint256 fee = value / 100;
            super._update(from, address(0xdead), fee);
            super._update(from, to, value - fee);
        } else {
            super._update(from, to, value);
        }
    }
}
