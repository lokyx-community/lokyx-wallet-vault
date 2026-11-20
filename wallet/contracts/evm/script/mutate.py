#!/usr/bin/env python3
"""Mutation check. Plants one deliberate bug at a time in src/PredictionMarket.sol and runs the whole test suite.
A mutant is KILLED if any test fails (the tests noticed the bug) and SURVIVED if every test still passes (a gap)."""
import subprocess, sys, shutil, os

SRC = "src/PredictionMarket.sol"
M = [
 ("expire may override a pending answer", 'require(m.proposed == 255, "an answer is waiting: finalize it or dispute it");', ""),
 ("dispute allowed after the window", 'require(block.timestamp < uint256(m.proposedAt) + WINDOW, "the challenge window is over: finalize it");', ""),
 ("finalize before the window ends", 'require(block.timestamp >= uint256(m.proposedAt) + WINDOW, "the challenge window is still open");', ""),
 ("proposer bond not returned on finalize", "m.bonds -= b;\n        free[m.proposer] += b;\n        _settle(id, m, m.proposed);", "m.bonds -= b;\n        _settle(id, m, m.proposed);"),
 ("panel winner paid 3 bonds", "+= 2 * b;\n                _settle(id, m, k);", "+= 3 * b;\n                _settle(id, m, k);"),
 ("panel winner is the wrong party", "free[k == m.proposed ? m.proposer : m.disputer]", "free[k == m.proposed ? m.disputer : m.proposer]"),
 ("panel majority too small", "uint256 need = m.panel.length / 2 + 1;", "uint256 need = m.panel.length / 2;"),
 ("fee-on-transfer tokens accepted", 'require(token.balanceOf(address(this)) - before == amount, "this token takes a fee on transfer");', ""),
 ("withdraw has no reentrancy lock", "function withdraw(uint256 amount) external nonReentrant {", "function withdraw(uint256 amount) external {"),
 ("deposit has no reentrancy lock", "function deposit(uint256 amount) external nonReentrant whenNotPaused {", "function deposit(uint256 amount) external whenNotPaused {"),
 ("seller overpaid by a dust amount", "free[ask.owner] += t * qq * cu;\n                yesOf[id][bid.owner] += q;", "free[ask.owner] += t * qq * cu + 1;\n                yesOf[id][bid.owner] += q;"),
 ("cancel refunds half of the locked coins", "free[o.owner] += o.locked;", "free[o.owner] += o.locked / 2;"),
 ("eviction does not refund", "_removeAt(id, at);\n        _refund(id, w);", "_removeAt(id, at);"),
 ("eviction also pushes out an equal price", "incBid ? inc.price <= w.price : inc.price >= w.price", "incBid ? inc.price < w.price : inc.price > w.price"),
 ("invalid market pays too much", "else pay = (y + n) * (m.unit / 2);", "else pay = (y + n) * (m.unit / 2 + 1);"),
 ("book cap not enforced", 'require(books[id].length < MAX_ORDERS, "the book is full of better-priced orders");', ""),
 ("false-returning token accepted", 'if (r.length > 0) require(r.length == 32 && abi.decode(r, (bool)), "token transfer failed");', ""),
 ("proposer can dispute themselves", 'require(msg.sender != m.proposer, "you can\'t dispute your own answer");', ""),
 ("proposal bond not tracked", "free[msg.sender] -= b;\n        m.bonds += b;\n        m.proposer = msg.sender;", "free[msg.sender] -= b;\n        m.proposer = msg.sender;"),
 ("disputer bond lost on a stuck dispute", "free[m.proposer] += b;\n            free[m.disputer] += b;", "free[m.proposer] += b;"),
 ("anyone can vote", 'require(idx != type(uint256).max, "only the panel can vote");', ""),
 ("votes allowed without a dispute", 'require(m.disputer != address(0), "the panel only decides disputed answers");', ""),
 ("claim pays winners one unit too many", "if (m.state == State.Yes) pay = y * m.unit;", "if (m.state == State.Yes) pay = y * m.unit + 1;"),
 ("propose before close", 'require(block.timestamp >= m.close, "answers open when the market closes");', ""),
]

orig = open(SRC).read()
shutil.copy(SRC, SRC + ".orig")
survived, killed, broken = [], [], []
try:
    for name, old, new in M:
        if orig.count(old) != 1:
            broken.append((name, f"pattern found {orig.count(old)} times"))
            print(f"?? {name}: pattern found {orig.count(old)} times", flush=True)
            continue
        open(SRC, "w").write(orig.replace(old, new))
        env = dict(os.environ, FOUNDRY_INVARIANT_RUNS="96", FOUNDRY_INVARIANT_DEPTH="150", FOUNDRY_FUZZ_RUNS="128")
        r = subprocess.run(["forge", "test", "-q"], capture_output=True, text=True, env=env)
        out = r.stdout + r.stderr
        if "Compiler run failed" in out or "Error (" in out:
            broken.append((name, "does not compile"))
            print(f"?? {name}: mutant does not compile", flush=True)
        elif r.returncode != 0:
            killed.append(name); print(f"killed    {name}", flush=True)
        else:
            survived.append(name); print(f"SURVIVED  {name}", flush=True)
finally:
    open(SRC, "w").write(orig)
    os.remove(SRC + ".orig")

print(f"\nkilled {len(killed)} / survived {len(survived)} / unusable {len(broken)} of {len(M)}")
for n in survived: print("  survived:", n)
for n, why in broken: print("  unusable:", n, "-", why)
sys.exit(1 if survived or broken else 0)
