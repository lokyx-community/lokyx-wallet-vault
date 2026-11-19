// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// Yes/no prediction markets with an order book, paid in one ERC-20 (USDT on BNB Chain). Same rules as the
/// LOKYX contract (wallet/contracts/market-engine): shares are backed by `unit` coins per pair, every order is
/// a limit order on one book priced in Yes terms, and a panel chosen at creation decides the result.
/// People deposit into a free balance, trade with it, and withdraw. Coins leave only on `withdraw`.
interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

contract PredictionMarket {
    IERC20 public immutable token;

    uint256 public constant MAX_ORDERS = 100;
    uint256 public constant WINDOW = 1 days;
    uint256 public constant EXPIRE_AFTER = 30 days;
    uint256 public constant MAX_TITLE = 140;

    enum Kind { Buy, Sell, MintNo, BurnNo }
    enum State { Open, Yes, No, Invalid }

    struct Order {
        uint64 id;
        address owner;
        Kind kind;
        uint8 price; // in Yes terms, 1 to 99
        uint64 qty;
        uint256 locked; // coins still locked (Buy and MintNo)
    }

    struct Market {
        address creator;
        string title;
        uint64 close;
        uint256 unit; // coins one winning share is worth; a multiple of 100
        State state;
        uint64 nextId;
        uint64 supply; // pairs in existence
        uint256 pool; // coins backing them
        address[] panel;
        uint8[] votes; // 255 = not voted, 0 Yes, 1 No, 2 Invalid
        uint8 decidedVote; // 255 = none yet
        uint64 decidedAt;
    }

    uint256 public count;
    mapping(uint256 => Market) internal markets;
    mapping(uint256 => Order[]) internal books;
    mapping(uint256 => mapping(address => uint64)) public yesOf;
    mapping(uint256 => mapping(address => uint64)) public noOf;
    mapping(address => uint256) public free;

    event Deposit(address indexed who, uint256 amount);
    event Withdraw(address indexed who, uint256 amount);
    event Created(uint256 indexed id, address indexed creator, uint64 close);
    event OrderPlaced(uint256 indexed id, uint64 order, address indexed who);
    event Voted(uint256 indexed id, address indexed who, uint8 vote);
    event Decided(uint256 indexed id, State state);

    constructor(address token_) {
        token = IERC20(token_);
    }

    // ---------- coins ----------

    function deposit(uint256 amount) external {
        require(amount > 0, "send some coins to deposit");
        _pull(msg.sender, amount);
        free[msg.sender] += amount;
        emit Deposit(msg.sender, amount);
    }

    function withdraw(uint256 amount) external {
        require(free[msg.sender] >= amount, "not enough free coins");
        free[msg.sender] -= amount;
        _push(msg.sender, amount);
        emit Withdraw(msg.sender, amount);
    }

    // USDT-style tokens may return nothing, so accept either.
    function _pull(address from, uint256 amount) internal {
        (bool ok, bytes memory r) = address(token).call(abi.encodeWithSelector(IERC20.transferFrom.selector, from, address(this), amount));
        require(ok && (r.length == 0 || abi.decode(r, (bool))), "token transfer failed");
    }

    function _push(address to, uint256 amount) internal {
        (bool ok, bytes memory r) = address(token).call(abi.encodeWithSelector(IERC20.transfer.selector, to, amount));
        require(ok && (r.length == 0 || abi.decode(r, (bool))), "token transfer failed");
    }

    // ---------- markets ----------

    function create(string calldata title, uint64 close, uint256 unit, address[] calldata panel) external returns (uint256 id) {
        require(bytes(title).length > 0 && bytes(title).length <= MAX_TITLE, "the question is empty or too long");
        require(close >= block.timestamp + 1 hours, "close at least an hour from now");
        require(unit >= 100 && unit % 100 == 0, "the share value must be a multiple of 100 base units");
        require(panel.length >= 3 && panel.length <= 9, "the panel needs between 3 and 9 people");
        for (uint256 i = 0; i < panel.length; i++) {
            for (uint256 j = 0; j < i; j++) require(panel[i] != panel[j], "a panel member is listed twice");
        }
        id = count++;
        Market storage m = markets[id];
        m.creator = msg.sender;
        m.title = title;
        m.close = close;
        m.unit = unit;
        m.panel = panel;
        for (uint256 i = 0; i < panel.length; i++) m.votes.push(255);
        m.decidedVote = 255;
        emit Created(id, msg.sender, close);
    }

    function _market(uint256 id) internal view returns (Market storage m) {
        require(id < count, "no such market");
        m = markets[id];
    }

    /// outcome: 0 Yes, 1 No. side: 0 buy, 1 sell. price is in the terms of `outcome` (62 = 62 cents per share).
    function place(uint256 id, uint8 outcome, uint8 side, uint8 price, uint64 qty) external returns (uint64) {
        Market storage m = _market(id);
        require(m.state == State.Open && block.timestamp < m.close, "this market is not taking orders");
        require(outcome < 2 && side < 2, "bad outcome or side");
        require(price >= 1 && price <= 99, "the price must be between 1 and 99");
        require(qty > 0, "buy or sell at least one share");
        require(books[id].length < MAX_ORDERS, "too many orders are waiting in this market");

        uint256 cu = m.unit / 100;
        Kind kind;
        uint8 yp;
        if (outcome == 0 && side == 0) { kind = Kind.Buy; yp = price; }
        else if (outcome == 0) { kind = Kind.Sell; yp = price; }
        else if (side == 0) { kind = Kind.MintNo; yp = 100 - price; }
        else { kind = Kind.BurnNo; yp = 100 - price; }

        uint256 locked = 0;
        if (kind == Kind.Buy || kind == Kind.MintNo) {
            locked = uint256(price) * uint256(qty) * cu;
            require(free[msg.sender] >= locked, "not enough coins deposited");
            free[msg.sender] -= locked;
        } else if (kind == Kind.Sell) {
            require(yesOf[id][msg.sender] >= qty, "you don't hold that many Yes shares");
            yesOf[id][msg.sender] -= qty;
        } else {
            require(noOf[id][msg.sender] >= qty, "you don't hold that many No shares");
            noOf[id][msg.sender] -= qty;
        }

        uint64 oid = m.nextId++;
        Order memory inc = Order(oid, msg.sender, kind, yp, qty, locked);
        _match(id, m, inc);
        if (inc.qty > 0) books[id].push(inc);
        emit OrderPlaced(id, oid, msg.sender);
        return oid;
    }

    function _isBid(Kind k) internal pure returns (bool) {
        return k == Kind.Buy || k == Kind.BurnNo;
    }

    function _best(uint256 id, Order memory inc) internal view returns (bool found, uint256 at) {
        Order[] storage book = books[id];
        bool incBid = _isBid(inc.kind);
        for (uint256 i = 0; i < book.length; i++) {
            Order storage r = book[i];
            if (_isBid(r.kind) == incBid) continue;
            if (incBid ? r.price > inc.price : r.price < inc.price) continue;
            if (!found) { found = true; at = i; continue; }
            Order storage cur = book[at];
            bool better = incBid
                ? (r.price < cur.price || (r.price == cur.price && r.id < cur.id))
                : (r.price > cur.price || (r.price == cur.price && r.id < cur.id));
            if (better) at = i;
        }
    }

    function _match(uint256 id, Market storage m, Order memory inc) internal {
        uint256 cu = m.unit / 100;
        while (inc.qty > 0) {
            (bool found, uint256 i) = _best(id, inc);
            if (!found) break;
            Order memory rest = books[id][i];
            uint64 q = inc.qty < rest.qty ? inc.qty : rest.qty;
            uint256 t = rest.price; // trade at the price of the order that was waiting
            uint256 qq = q;
            bool incBid = _isBid(inc.kind);
            Order memory bid = incBid ? inc : rest;
            Order memory ask = incBid ? rest : inc;

            if (bid.kind == Kind.Buy && ask.kind == Kind.Sell) {
                free[ask.owner] += t * qq * cu;
                yesOf[id][bid.owner] += q;
            } else if (bid.kind == Kind.Buy && ask.kind == Kind.MintNo) {
                yesOf[id][bid.owner] += q;
                noOf[id][ask.owner] += q;
                m.supply += q;
                m.pool += 100 * qq * cu;
            } else if (bid.kind == Kind.BurnNo && ask.kind == Kind.Sell) {
                free[ask.owner] += t * qq * cu;
                free[bid.owner] += (100 - t) * qq * cu;
                m.supply -= q;
                m.pool -= 100 * qq * cu;
            } else {
                // BurnNo meets MintNo: the No share changes hands
                free[bid.owner] += (100 - t) * qq * cu;
                noOf[id][ask.owner] += q;
            }
            // a buyer's locked coins: pay what was due at the trade price, give back any difference
            if (bid.kind == Kind.Buy) {
                uint256 held = uint256(bid.price) * qq * cu;
                bid.locked -= held;
                free[bid.owner] += held - t * qq * cu;
            }
            if (ask.kind == Kind.MintNo) {
                uint256 held = (100 - uint256(ask.price)) * qq * cu;
                ask.locked -= held;
                free[ask.owner] += held - (100 - t) * qq * cu;
            }
            bid.qty -= q;
            ask.qty -= q;

            if (rest.qty == 0) {
                _removeAt(id, i);
            } else {
                books[id][i] = rest;
            }
        }
    }

    function _removeAt(uint256 id, uint256 i) internal {
        Order[] storage book = books[id];
        book[i] = book[book.length - 1]; // priority is by id, not position, so order in the array doesn't matter
        book.pop();
    }

    function cancel(uint256 id, uint64 orderId) external {
        _market(id);
        Order[] storage book = books[id];
        for (uint256 i = 0; i < book.length; i++) {
            if (book[i].id == orderId) {
                require(book[i].owner == msg.sender, "that order isn't yours");
                Order memory o = book[i];
                _removeAt(id, i);
                _refund(id, o);
                return;
            }
        }
        revert("no such order");
    }

    function _refund(uint256 id, Order memory o) internal {
        if (o.kind == Kind.Buy || o.kind == Kind.MintNo) free[o.owner] += o.locked;
        else if (o.kind == Kind.Sell) yesOf[id][o.owner] += o.qty;
        else noOf[id][o.owner] += o.qty;
    }

    // ---------- the panel ----------

    /// vote: 0 Yes, 1 No, 2 Invalid. Can be changed until the market is final.
    function vote(uint256 id, uint8 v) external {
        Market storage m = _market(id);
        require(m.state == State.Open, "this market is already decided");
        require(block.timestamp >= m.close, "voting opens when the market closes");
        require(v < 3, "vote is 0 (Yes), 1 (No) or 2 (Invalid)");
        uint256 idx = type(uint256).max;
        for (uint256 i = 0; i < m.panel.length; i++) if (m.panel[i] == msg.sender) idx = i;
        require(idx != type(uint256).max, "only the panel can vote");
        m.votes[idx] = v;

        uint256 need = m.panel.length / 2 + 1;
        uint256[3] memory tally;
        for (uint256 i = 0; i < m.votes.length; i++) if (m.votes[i] < 3) tally[m.votes[i]]++;
        uint8 winner = 255;
        for (uint8 k = 0; k < 3; k++) if (tally[k] >= need) { winner = k; break; }
        if (winner == 255) {
            m.decidedVote = 255;
        } else if (m.decidedVote != winner) {
            m.decidedVote = winner;
            m.decidedAt = uint64(block.timestamp);
        }
        emit Voted(id, msg.sender, v);
    }

    /// Makes the panel's decision final once the window has passed. Anyone can call it.
    function finalize(uint256 id) external {
        Market storage m = _market(id);
        require(m.state == State.Open, "this market is already decided");
        require(m.decidedVote != 255, "the panel has not agreed yet");
        require(block.timestamp >= uint256(m.decidedAt) + WINDOW, "the objection window is still open");
        m.state = m.decidedVote == 0 ? State.Yes : m.decidedVote == 1 ? State.No : State.Invalid;
        emit Decided(id, m.state);
    }

    /// Ends an undecided market as Invalid long after the close, so coins are never stuck for ever.
    function expire(uint256 id) external {
        Market storage m = _market(id);
        require(m.state == State.Open, "this market is already decided");
        require(block.timestamp >= uint256(m.close) + EXPIRE_AFTER, "not yet: the panel still has time");
        m.state = State.Invalid;
        emit Decided(id, State.Invalid);
    }

    /// After a market is decided: cancels your waiting orders and pays your shares into your free balance.
    function claim(uint256 id) external returns (uint256 pay) {
        Market storage m = _market(id);
        require(m.state != State.Open, "this market is not decided yet");
        Order[] storage book = books[id];
        uint256 i = 0;
        while (i < book.length) {
            if (book[i].owner == msg.sender) {
                Order memory o = book[i];
                _removeAt(id, i);
                _refund(id, o);
            } else {
                i++;
            }
        }
        uint256 y = yesOf[id][msg.sender];
        uint256 n = noOf[id][msg.sender];
        yesOf[id][msg.sender] = 0;
        noOf[id][msg.sender] = 0;
        if (m.state == State.Yes) pay = y * m.unit;
        else if (m.state == State.No) pay = n * m.unit;
        else pay = (y + n) * (m.unit / 2);
        m.pool -= pay;
        free[msg.sender] += pay;
    }

    // ---------- reading ----------

    function info(uint256 id) external view returns (
        string memory title, address creator, uint64 close, uint256 unit, State state, uint64 supply, uint256 pool, address[] memory panel, uint8[] memory votes
    ) {
        Market storage m = _market(id);
        return (m.title, m.creator, m.close, m.unit, m.state, m.supply, m.pool, m.panel, m.votes);
    }

    /// Waiting orders: outcome 0 Yes / 1 No, side 0 buy / 1 sell, price in that outcome's own terms.
    function book(uint256 id) external view returns (uint64[] memory ids, address[] memory owners, uint8[] memory outcomes, uint8[] memory sides, uint8[] memory prices, uint64[] memory qtys) {
        Order[] storage b = books[id];
        uint256 n = b.length;
        ids = new uint64[](n); owners = new address[](n); outcomes = new uint8[](n);
        sides = new uint8[](n); prices = new uint8[](n); qtys = new uint64[](n);
        for (uint256 i = 0; i < n; i++) {
            Order storage o = b[i];
            ids[i] = o.id;
            owners[i] = o.owner;
            bool no = o.kind == Kind.MintNo || o.kind == Kind.BurnNo;
            outcomes[i] = no ? 1 : 0;
            sides[i] = (o.kind == Kind.Sell || o.kind == Kind.BurnNo) ? 1 : 0;
            prices[i] = no ? 100 - o.price : o.price;
            qtys[i] = o.qty;
        }
    }
}
