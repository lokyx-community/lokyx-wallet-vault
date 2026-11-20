// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// Yes/no prediction markets with an order book, paid in one ERC-20 (USDT on BNB Chain). Same rules as the
/// LOKYX contract (wallet/contracts/market-engine): shares are backed by `unit` coins per pair, every order is
/// a limit order on one book priced in Yes terms. Results are settled the way Polymarket's optimistic oracle does it:
/// after the close anyone proposes an answer with a bond, anyone can dispute it inside a challenge window with an equal
/// bond, and only a dispute reaches the panel chosen at creation, which then acts as the final judge.
/// People deposit into a free balance, trade with it, and withdraw. Coins leave only on `withdraw`.
interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function balanceOf(address who) external view returns (uint256);
}

/// Token calls that fail loudly. USDT-style tokens return nothing from transfer, so an empty answer is accepted,
/// but only from an address that really has code (a call to an empty address "succeeds" and moves nothing).
library SafeERC20 {
    function safeTransfer(IERC20 t, address to, uint256 v) internal {
        _call(address(t), abi.encodeCall(IERC20.transfer, (to, v)));
    }

    function safeTransferFrom(IERC20 t, address from, address to, uint256 v) internal {
        _call(address(t), abi.encodeCall(IERC20.transferFrom, (from, to, v)));
    }

    function _call(address t, bytes memory data) private {
        require(t.code.length > 0, "the token must be a contract");
        (bool ok, bytes memory r) = t.call(data);
        require(ok, "token transfer failed");
        if (r.length > 0) require(r.length == 32 && abi.decode(r, (bool)), "token transfer failed");
    }
}

interface IERC1155Receiver {
    function onERC1155Received(address operator, address from, uint256 id, uint256 value, bytes calldata data) external returns (bytes4);
    function onERC1155BatchReceived(address operator, address from, uint256[] calldata ids, uint256[] calldata values, bytes calldata data) external returns (bytes4);
}

contract PredictionMarket {
    using SafeERC20 for IERC20;

    IERC20 public immutable token;

    /// Taker fee, in basis points of the taker's side of each trade, fixed when the market contract is deployed. It can
    /// never be raised afterwards (there is no setter) and can never exceed MAX_FEE_BPS. Of each fee: 20% goes to the
    /// order that was waiting (the maker), 20% is held for whoever ends up giving the right answer, 60% to the collector.
    uint256 public immutable feeBps;
    address public immutable feeCollector;
    uint256 public constant MAX_FEE_BPS = 100;
    uint256 public constant MAKER_SHARE = 20; // percent of each fee
    uint256 public constant ANSWER_SHARE = 20; // percent of each fee

    /// The owner can only pause NEW activity (deposits, new markets, new orders). It can never touch anyone's coins,
    /// and withdrawals, cancels, votes, finalizing, expiring and claims keep working while paused.
    address public owner;
    bool public paused;
    uint256 private _lock = 1;

    uint256 public constant MAX_ORDERS = 100;
    uint256 public constant WINDOW = 1 days;
    uint256 public constant EXPIRE_AFTER = 30 days;
    uint256 public constant MAX_TITLE = 140;
    /// Both the proposer and a disputer put up this many shares' worth of coins. The loser of a dispute forfeits it.
    uint256 public constant BOND_SHARES = 20;

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
        uint8[] votes; // the panel's votes once an answer is disputed: 255 = not voted, 0 Yes, 1 No, 2 Invalid
        uint8 proposed; // 255 = nobody has proposed an answer yet
        address proposer;
        uint64 proposedAt;
        address disputer;
        uint64 disputedAt;
        uint256 bonds; // coins held as bonds for this market
        uint256 answerFees; // the answer share of fees, held until the market is decided
    }

    uint256 public count;
    mapping(uint256 => Market) internal markets;
    mapping(uint256 => Order[]) internal books;
    // Shares are ERC-1155 tokens issued by this contract: market `id` has Yes shares as token 2*id and No shares as
    // token 2*id+1. Shares waiting in a sell order are held by the contract itself (their escrow), so for every token
    // the balances of everyone plus the contract always add up to the shares in existence.
    mapping(uint256 => mapping(address => uint256)) private _bal;
    mapping(address => mapping(address => bool)) private _operators;
    mapping(address => uint256) public free;

    event Deposit(address indexed who, uint256 amount);
    event Withdraw(address indexed who, uint256 amount);
    event Created(uint256 indexed id, address indexed creator, uint64 close);
    event OrderPlaced(uint256 indexed id, uint64 order, address indexed who);
    event Voted(uint256 indexed id, address indexed who, uint8 vote);
    event Proposed(uint256 indexed id, address indexed who, uint8 outcome);
    event Disputed(uint256 indexed id, address indexed who);
    event Evicted(uint256 indexed id, uint64 order);
    /// One per match. `price` is in Yes terms, 1 to 99; `fee` is what the taker paid on this match.
    event Traded(uint256 indexed id, uint8 price, uint64 qty, address indexed taker, address indexed maker, uint256 fee);
    event TransferSingle(address indexed operator, address indexed from, address indexed to, uint256 id, uint256 value);
    event TransferBatch(address indexed operator, address indexed from, address indexed to, uint256[] ids, uint256[] values);
    event ApprovalForAll(address indexed account, address indexed operator, bool approved);
    event URI(string value, uint256 indexed id);
    event Decided(uint256 indexed id, State state);

    modifier nonReentrant() {
        require(_lock == 1, "reentrant call");
        _lock = 2;
        _;
        _lock = 1;
    }

    modifier whenNotPaused() {
        require(!paused, "paused: no new deposits, markets or orders");
        _;
    }

    modifier onlyOwner() {
        require(msg.sender == owner, "only the owner");
        _;
    }

    event Paused(bool paused);
    event OwnershipTransferred(address indexed from, address indexed to);

    constructor(address token_, address collector_, uint256 feeBps_) {
        require(token_ != address(0) && token_.code.length > 0, "the token must be a contract");
        require(feeBps_ <= MAX_FEE_BPS, "the fee is above the maximum");
        require(feeBps_ == 0 || collector_ != address(0), "a fee needs a collector");
        token = IERC20(token_);
        feeBps = feeBps_;
        feeCollector = collector_;
        owner = msg.sender;
        emit OwnershipTransferred(address(0), msg.sender);
    }

    function setPaused(bool p) external onlyOwner {
        paused = p;
        emit Paused(p);
    }

    function transferOwnership(address to) external onlyOwner {
        emit OwnershipTransferred(owner, to);
        owner = to; // address(0) gives the owner role up for good
    }

    // ---------- coins ----------

    function deposit(uint256 amount) external nonReentrant whenNotPaused {
        require(amount > 0, "send some coins to deposit");
        uint256 before = token.balanceOf(address(this));
        token.safeTransferFrom(msg.sender, address(this), amount);
        // credit only what really arrived: a token that skims a fee would otherwise leave the market short
        require(token.balanceOf(address(this)) - before == amount, "this token takes a fee on transfer");
        free[msg.sender] += amount;
        emit Deposit(msg.sender, amount);
    }

    function withdraw(uint256 amount) external nonReentrant {
        require(free[msg.sender] >= amount, "not enough free coins");
        free[msg.sender] -= amount; // effects before the outside call
        token.safeTransfer(msg.sender, amount);
        emit Withdraw(msg.sender, amount);
    }

    // ---------- markets ----------

    function create(string calldata title, uint64 close, uint256 unit, address[] calldata panel) external whenNotPaused returns (uint256 id) {
        require(bytes(title).length > 0 && bytes(title).length <= MAX_TITLE, "the question is empty or too long");
        require(close >= block.timestamp + 1 hours, "close at least an hour from now");
        require(unit >= 100 && unit % 100 == 0, "the share value must be a multiple of 100 base units");
        require(panel.length >= 3 && panel.length <= 9, "the panel needs between 3 and 9 people");
        for (uint256 i = 0; i < panel.length; i++) {
            require(panel[i] != address(0) && panel[i] != address(this) && panel[i] != address(token), "that can't be a panel member");
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
        m.proposed = 255;
        emit Created(id, msg.sender, close);
    }

    function _market(uint256 id) internal view returns (Market storage m) {
        require(id < count, "no such market");
        m = markets[id];
    }

    /// outcome: 0 Yes, 1 No. side: 0 buy, 1 sell. price is in the terms of `outcome` (62 = 62 cents per share).
    function place(uint256 id, uint8 outcome, uint8 side, uint8 price, uint64 qty) external whenNotPaused returns (uint64) {
        Market storage m = _market(id);
        require(m.state == State.Open && block.timestamp < m.close, "this market is not taking orders");
        require(outcome < 2 && side < 2, "bad outcome or side");
        require(price >= 1 && price <= 99, "the price must be between 1 and 99");
        require(qty > 0, "buy or sell at least one share");

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
            // the taker fee, if this order trades, is paid from free coins on top of what is locked
            require(free[msg.sender] >= locked + locked * feeBps / 10_000, "not enough coins deposited");
            free[msg.sender] -= locked;
        } else if (kind == Kind.Sell) {
            require(_bal[id * 2][msg.sender] >= qty, "you don't hold that many Yes shares");
            _shift(id * 2, msg.sender, address(this), qty);
        } else {
            require(_bal[id * 2 + 1][msg.sender] >= qty, "you don't hold that many No shares");
            _shift(id * 2 + 1, msg.sender, address(this), qty);
        }

        uint64 oid = m.nextId++;
        Order memory inc = Order(oid, msg.sender, kind, yp, qty, locked);
        _match(id, m, inc);
        if (inc.qty > 0) {
            // The cap limits only what can REST. If this order traded at all, a resting order was used up and removed,
            // so there is room. Otherwise, when the book is full, an order priced better than the worst waiting order
            // on its own side takes that place and the pushed-out owner gets everything back, so spam can't lock others out.
            if (books[id].length >= MAX_ORDERS) _evictWorseThan(id, inc);
            require(books[id].length < MAX_ORDERS, "the book is full of better-priced orders");
            books[id].push(inc);
        }
        emit OrderPlaced(id, oid, msg.sender);
        return oid;
    }

    function _isBid(Kind k) internal pure returns (bool) {
        return k == Kind.Buy || k == Kind.BurnNo;
    }

    function _evictWorseThan(uint256 id, Order memory inc) internal {
        Order[] storage book = books[id];
        bool incBid = _isBid(inc.kind);
        bool found;
        uint256 at;
        for (uint256 i = 0; i < book.length; i++) {
            Order storage r = book[i];
            if (_isBid(r.kind) != incBid) continue;
            if (!found) { found = true; at = i; continue; }
            Order storage cur = book[at];
            // the worst bid has the lowest price, the worst ask the highest; among equals the newest loses
            bool worse = incBid
                ? (r.price < cur.price || (r.price == cur.price && r.id > cur.id))
                : (r.price > cur.price || (r.price == cur.price && r.id > cur.id));
            if (worse) at = i;
        }
        if (!found) return;
        Order memory w = book[at];
        if (incBid ? inc.price <= w.price : inc.price >= w.price) return; // not strictly better: turned away
        _removeAt(id, at);
        _refund(id, w);
        emit Evicted(id, w.id);
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
                _shift(id * 2, address(this), bid.owner, q);
            } else if (bid.kind == Kind.Buy && ask.kind == Kind.MintNo) {
                _mint(id * 2, bid.owner, q);
                _mint(id * 2 + 1, ask.owner, q);
                m.supply += q;
                m.pool += 100 * qq * cu;
            } else if (bid.kind == Kind.BurnNo && ask.kind == Kind.Sell) {
                free[ask.owner] += t * qq * cu;
                free[bid.owner] += (100 - t) * qq * cu;
                _burn(id * 2, address(this), q);
                _burn(id * 2 + 1, address(this), q);
                m.supply -= q;
                m.pool -= 100 * qq * cu;
            } else {
                // BurnNo meets MintNo: the No share changes hands
                free[bid.owner] += (100 - t) * qq * cu;
                _shift(id * 2 + 1, address(this), ask.owner, q);
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

            _takeFee(id, m, inc, rest, t, qq, cu, q);

            if (rest.qty == 0) {
                _removeAt(id, i);
            } else {
                books[id][i] = rest;
            }
        }
    }

    /// The taker (the incoming order) pays the fee on its own side of the trade, rounded down so the up-front check in
    /// place() always covers it. The maker gets its share at once; the answer share waits in the market.
    function _takeFee(uint256 id, Market storage m, Order memory inc, Order memory rest, uint256 t, uint256 qq, uint256 cu, uint64 q) internal {
        uint256 fee = 0;
        if (feeBps > 0) {
            uint256 side = (inc.kind == Kind.Buy || inc.kind == Kind.Sell) ? t : 100 - t;
            fee = side * qq * cu * feeBps / 10_000;
            if (fee > 0) {
                free[inc.owner] -= fee;
                uint256 maker = fee * MAKER_SHARE / 100;
                uint256 answer = fee * ANSWER_SHARE / 100;
                free[rest.owner] += maker;
                m.answerFees += answer;
                free[feeCollector] += fee - maker - answer;
            }
        }
        emit Traded(id, uint8(t), q, inc.owner, rest.owner, fee);
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
        else if (o.kind == Kind.Sell) _shift(id * 2, address(this), o.owner, o.qty);
        else _shift(id * 2 + 1, address(this), o.owner, o.qty);
    }

    // ---------- settling a market ----------

    function bondOf(uint256 id) public view returns (uint256) {
        return _market(id).unit * BOND_SHARES;
    }

    /// Pays the market's held answer share to `to`, or to the collector when nobody earned it.
    function _payAnswerFees(Market storage m, address to) internal {
        uint256 a = m.answerFees;
        if (a == 0) return;
        m.answerFees = 0;
        free[to == address(0) ? feeCollector : to] += a;
    }

    function answerFees(uint256 id) external view returns (uint256) {
        return _market(id).answerFees;
    }

    function _settle(uint256 id, Market storage m, uint8 outcome) internal {
        m.state = outcome == 0 ? State.Yes : outcome == 1 ? State.No : State.Invalid;
        emit Decided(id, m.state);
    }

    /// Step 1. Once the market has closed anyone can propose the answer (0 Yes, 1 No, 2 Invalid) and lock a bond.
    /// These steps stay open while the contract is paused, so a pause can never keep a market from being settled.
    function propose(uint256 id, uint8 outcome) external {
        Market storage m = _market(id);
        require(m.state == State.Open, "this market is already decided");
        require(block.timestamp >= m.close, "answers open when the market closes");
        require(m.proposed == 255, "an answer has already been proposed");
        require(outcome < 3, "answer is 0 (Yes), 1 (No) or 2 (Invalid)");
        uint256 b = m.unit * BOND_SHARES;
        require(free[msg.sender] >= b, "not enough free coins for the bond");
        free[msg.sender] -= b;
        m.bonds += b;
        m.proposer = msg.sender;
        m.proposed = outcome;
        m.proposedAt = uint64(block.timestamp);
        emit Proposed(id, msg.sender, outcome);
    }

    /// Step 2 (only if someone thinks the answer is wrong). Inside the challenge window anyone can dispute it with an
    /// equal bond. A dispute hands the decision to the panel.
    function dispute(uint256 id) external {
        Market storage m = _market(id);
        require(m.state == State.Open && m.proposed != 255, "there is no answer to dispute");
        require(m.disputer == address(0), "already disputed");
        require(msg.sender != m.proposer, "you can't dispute your own answer");
        require(block.timestamp < uint256(m.proposedAt) + WINDOW, "the challenge window is over: finalize it");
        uint256 b = m.unit * BOND_SHARES;
        require(free[msg.sender] >= b, "not enough free coins for the bond");
        free[msg.sender] -= b;
        m.bonds += b;
        m.disputer = msg.sender;
        m.disputedAt = uint64(block.timestamp);
        emit Disputed(id, msg.sender);
    }

    /// Step 3 when nobody disputed. Anyone can call it once the window has passed; the bond goes back to the proposer.
    function finalize(uint256 id) external {
        Market storage m = _market(id);
        require(m.state == State.Open, "this market is already decided");
        require(m.proposed != 255 && m.disputer == address(0), "there is no undisputed answer");
        require(block.timestamp >= uint256(m.proposedAt) + WINDOW, "the challenge window is still open");
        uint256 b = m.unit * BOND_SHARES;
        m.bonds -= b;
        free[m.proposer] += b;
        _payAnswerFees(m, m.proposer);
        _settle(id, m, m.proposed);
    }

    /// Step 3 when someone disputed: the panel decides, vote 0 Yes, 1 No, 2 Invalid, changeable until a majority
    /// agrees. That majority is final. If it matches the proposal the proposer takes both bonds, otherwise the disputer does.
    function vote(uint256 id, uint8 v) external {
        Market storage m = _market(id);
        require(m.state == State.Open, "this market is already decided");
        require(m.disputer != address(0), "the panel only decides disputed answers");
        require(v < 3, "vote is 0 (Yes), 1 (No) or 2 (Invalid)");
        uint256 idx = type(uint256).max;
        for (uint256 i = 0; i < m.panel.length; i++) if (m.panel[i] == msg.sender) idx = i;
        require(idx != type(uint256).max, "only the panel can vote");
        m.votes[idx] = v;
        emit Voted(id, msg.sender, v);

        uint256 need = m.panel.length / 2 + 1;
        uint256[3] memory tally;
        for (uint256 i = 0; i < m.votes.length; i++) if (m.votes[i] < 3) tally[m.votes[i]]++;
        for (uint8 k = 0; k < 3; k++) {
            if (tally[k] >= need) {
                uint256 b = m.unit * BOND_SHARES;
                m.bonds -= 2 * b;
                address winner = k == m.proposed ? m.proposer : m.disputer;
                free[winner] += 2 * b;
                _payAnswerFees(m, winner);
                _settle(id, m, k);
                return;
            }
        }
    }

    /// Ends a stuck market as Invalid so coins are never held for ever: no answer 30 days after the close, or a
    /// dispute the panel did not settle within 30 days (both bonds are given back). A pending undisputed answer
    /// cannot be overridden: it has to be finalized or disputed.
    function expire(uint256 id) external {
        Market storage m = _market(id);
        require(m.state == State.Open, "this market is already decided");
        if (m.disputer != address(0)) {
            require(block.timestamp >= uint256(m.disputedAt) + EXPIRE_AFTER, "not yet: the panel still has time");
            uint256 b = m.unit * BOND_SHARES;
            m.bonds -= 2 * b;
            free[m.proposer] += b;
            free[m.disputer] += b;
        } else {
            require(m.proposed == 255, "an answer is waiting: finalize it or dispute it");
            require(block.timestamp >= uint256(m.close) + EXPIRE_AFTER, "not yet: there is still time to propose");
        }
        _payAnswerFees(m, address(0));
        _settle(id, m, 2);
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
        uint256 y = _bal[id * 2][msg.sender];
        uint256 n = _bal[id * 2 + 1][msg.sender];
        if (y > 0) _burn(id * 2, msg.sender, y);
        if (n > 0) _burn(id * 2 + 1, msg.sender, n);
        if (m.state == State.Yes) pay = y * m.unit;
        else if (m.state == State.No) pay = n * m.unit;
        else pay = (y + n) * (m.unit / 2);
        m.pool -= pay;
        free[msg.sender] += pay;
    }

    // ---------- shares as ERC-1155 tokens ----------

    function yesOf(uint256 id, address who) external view returns (uint64) { return uint64(_bal[id * 2][who]); }
    function noOf(uint256 id, address who) external view returns (uint64) { return uint64(_bal[id * 2 + 1][who]); }

    function balanceOf(address who, uint256 tokenId) public view returns (uint256) {
        require(who != address(0), "the zero address holds nothing");
        return _bal[tokenId][who];
    }

    function balanceOfBatch(address[] calldata whos, uint256[] calldata tokenIds) external view returns (uint256[] memory out) {
        require(whos.length == tokenIds.length, "lists differ in length");
        out = new uint256[](whos.length);
        for (uint256 i = 0; i < whos.length; i++) out[i] = balanceOf(whos[i], tokenIds[i]);
    }

    function setApprovalForAll(address operator, bool approved) external {
        require(operator != msg.sender, "you can't approve yourself");
        _operators[msg.sender][operator] = approved;
        emit ApprovalForAll(msg.sender, operator, approved);
    }

    function isApprovedForAll(address account, address operator) public view returns (bool) {
        return _operators[account][operator];
    }

    function uri(uint256) external pure returns (string memory) { return ""; }

    function supportsInterface(bytes4 i) external pure returns (bool) {
        return i == 0x01ffc9a7 || i == 0xd9b67a26; // ERC-165, ERC-1155
    }

    function safeTransferFrom(address from, address to, uint256 tokenId, uint256 value, bytes calldata data) external nonReentrant {
        _checkTransfer(from, to, tokenId);
        _shift(tokenId, from, to, value);
        _acceptance(from, to, tokenId, value, data);
    }

    function safeBatchTransferFrom(address from, address to, uint256[] calldata tokenIds, uint256[] calldata values, bytes calldata data) external nonReentrant {
        require(tokenIds.length == values.length, "lists differ in length");
        require(from == msg.sender || isApprovedForAll(from, msg.sender), "you are not allowed to move these shares");
        require(to != address(0) && to != address(this), "bad recipient");
        for (uint256 i = 0; i < tokenIds.length; i++) {
            _bal[tokenIds[i]][from] -= values[i];
            _bal[tokenIds[i]][to] += values[i];
        }
        emit TransferBatch(msg.sender, from, to, tokenIds, values);
        if (to.code.length > 0) {
            bytes4 ret;
            try IERC1155Receiver(to).onERC1155BatchReceived(msg.sender, from, tokenIds, values, data) returns (bytes4 r) { ret = r; } catch { revert("the receiver refused the shares"); }
            require(ret == IERC1155Receiver.onERC1155BatchReceived.selector, "the receiver refused the shares");
        }
    }

    function _checkTransfer(address from, address to, uint256 tokenId) internal view {
        require(from == msg.sender || isApprovedForAll(from, msg.sender), "you are not allowed to move these shares");
        require(to != address(0) && to != address(this), "bad recipient");
        require(tokenId / 2 < count, "no such market");
    }

    function _acceptance(address from, address to, uint256 tokenId, uint256 value, bytes calldata data) internal {
        if (to.code.length == 0) return;
        bytes4 ret;
        try IERC1155Receiver(to).onERC1155Received(msg.sender, from, tokenId, value, data) returns (bytes4 r) { ret = r; } catch { revert("the receiver refused the shares"); }
        require(ret == IERC1155Receiver.onERC1155Received.selector, "the receiver refused the shares");
    }

    function _mint(uint256 tokenId, address to, uint256 q) internal {
        _bal[tokenId][to] += q;
        emit TransferSingle(msg.sender, address(0), to, tokenId, q);
    }

    function _burn(uint256 tokenId, address from, uint256 q) internal {
        _bal[tokenId][from] -= q;
        emit TransferSingle(msg.sender, from, address(0), tokenId, q);
    }

    function _shift(uint256 tokenId, address from, address to, uint256 q) internal {
        _bal[tokenId][from] -= q;
        _bal[tokenId][to] += q;
        emit TransferSingle(msg.sender, from, to, tokenId, q);
    }

    // ---------- reading ----------

    function info(uint256 id) external view returns (
        string memory title, address creator, uint64 close, uint256 unit, State state, uint64 supply, uint256 pool, address[] memory panel, uint8[] memory votes
    ) {
        Market storage m = _market(id);
        return (m.title, m.creator, m.close, m.unit, m.state, m.supply, m.pool, m.panel, m.votes);
    }

    function resolution(uint256 id) external view returns (uint8 proposed, address proposer, uint64 proposedAt, address disputer, uint64 disputedAt, uint256 bond, uint256 bonds) {
        Market storage m = _market(id);
        return (m.proposed, m.proposer, m.proposedAt, m.disputer, m.disputedAt, m.unit * BOND_SHARES, m.bonds);
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
