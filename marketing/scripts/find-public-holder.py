"""Find a public contract (e.g. a DEX pool) on Robinhood Chain that holds Stock Tokens, for the wallet-check demo.
Public RPC only allows eth_getLogs over the last ~64 blocks with an address filter, so this polls recent Transfer
logs of every Stock Token in web/public/data/stock-tokens.json for N seconds, then reads balanceOf of every
Stock Token for the most active counterparties that are contracts. Read-only."""
import json, sys, time, urllib.request, collections
RPC = 'https://robinhood-rpc.publicnode.com'
TRANSFER = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'
LIST = json.load(open('/Users/medikamedika/KOMET/web/public/data/stock-tokens.json'))
TOKENS = [t['address'] for t in LIST['tokens']]
SYM = {t['address'].lower(): t['symbol'] for t in LIST['tokens']}
LOOK = {t['address'].lower(): t['symbol'] for t in LIST['lookalikes']}
def rpc(method, params):
    req = urllib.request.Request(RPC, data=json.dumps({'jsonrpc':'2.0','id':1,'method':method,'params':params}).encode(), headers={'content-type':'application/json','user-agent':'revers-marketing/1'})
    r = json.load(urllib.request.urlopen(req, timeout=30))
    if 'error' in r: raise RuntimeError(r['error'])
    return r['result']
POPULAR = ['NVDA','TSLA','AAPL','GOOGL','AMZN','MSFT','META','GME','AMD','PLTR','COIN','HOOD','SPY','QQQ','NFLX','MSTR']
WATCH = [t['address'] for t in LIST['tokens'] if t['symbol'] in POPULAR]
secs = int(sys.argv[1]) if len(sys.argv) > 1 else 60
counts = collections.Counter(); last = None; t_end = time.time() + secs
while time.time() < t_end:
    head = int(rpc('eth_blockNumber', []), 16)
    frm = max(head - 60, (last + 1) if last else head - 60)
    try:
        logs = []
        for i in range(0, len(WATCH), 8):
            logs += rpc('eth_getLogs', [{'address': WATCH[i:i+8], 'fromBlock': hex(frm), 'toBlock': hex(head), 'topics': [TRANSFER]}])
        for l in logs:
            for t in l['topics'][1:3]:
                a = '0x' + t[-40:]
                if int(a, 16) != 0: counts[a] += 1
        last = head
    except Exception as e:
        print('err', str(e)[:100])
    time.sleep(3)
print('distinct counterparties', len(counts))
def bal(token, holder):
    return int(rpc('eth_call', [{'to': token, 'data': '0x70a08231' + holder[2:].rjust(64, '0')}, 'latest']), 16)
for addr, n in counts.most_common(12):
    code = rpc('eth_getCode', [addr, 'latest'])
    if len(code) <= 2:
        print(addr, n, 'EOA (skipped)'); continue
    held = []
    for tk in TOKENS + [t['address'] for t in LIST['lookalikes']]:
        try:
            b = bal(tk, addr)
        except Exception:
            continue
        if b: held.append(f"{SYM.get(tk.lower()) or ('LOOKALIKE ' + LOOK.get(tk.lower(), '?'))}={b/1e18:.4f}")
    print(addr, n, 'contract', len(code)//2 - 1, 'bytes;', len(held), 'holdings:', ', '.join(held[:12]))
