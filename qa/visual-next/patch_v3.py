from pathlib import Path

path = Path('atlas-x-next/index-v3.html')
text = path.read_text(encoding='utf-8')
replacements = {
    '*{box-sizing:border-box}html,body': '*{box-sizing:border-box}[hidden]{display:none!important}html,body',
    'grid-template-rows:minmax(440px,1fr) 218px': 'grid-template-rows:minmax(440px,1fr) 190px',
    '.book-rows{min-height:0;flex:1;display:flex;flex-direction:column;justify-content:space-evenly}': '.book-rows{min-height:0;flex:1;display:flex;flex-direction:column;justify-content:flex-start;overflow:hidden}',
    '.book-row,.trade-row{position:relative;min-height:27px;': '.book-row,.trade-row{position:relative;min-height:0;height:28px;flex:0 0 28px;',
    '.empty-row td{height:130px;': '.empty-row td{height:105px;',
    '.sheet-backdrop{position:fixed;': '.sheet-backdrop:not([hidden]){position:fixed;',
    'const rows=mobile?8:10;': 'const rows=mobile?7:(innerHeight<1000?7:9);',
    '<button class="round-action" type="button" aria-label="通知">⌁</button>': '<button class="round-action" type="button" aria-label="通知"><svg viewBox="0 0 24 24"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 7h18s-3 0-3-7"/><path d="M10 19h4"/></svg></button>',
    '<button class="icon-only" type="button" aria-label="图表设置">⌁</button>': '<button class="icon-only" type="button" aria-label="图表设置"><svg viewBox="0 0 24 24"><path d="M4 7h10M18 7h2M4 17h2M10 17h10"/><circle cx="16" cy="7" r="2"/><circle cx="8" cy="17" r="2"/></svg></button>',
    '<button class="icon-only" type="button" aria-label="全屏">⛶</button>': '<button class="icon-only" type="button" aria-label="全屏"><svg viewBox="0 0 24 24"><path d="M8 3H3v5M16 3h5v5M8 21H3v-5M16 21h5v-5"/></svg></button>',
    '<button class="panel-menu" type="button" aria-label="盘口显示设置">☷</button>': '<button class="panel-menu" type="button" aria-label="盘口显示设置"><svg viewBox="0 0 24 24"><path d="M5 6h14M5 12h14M5 18h14"/></svg></button>',
    '<button type="button" aria-label="加入自选">☆</button>': '<button type="button" aria-label="加入自选"><svg viewBox="0 0 24 24"><path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.1-5.6-2.9-5.6 2.9 1.1-6.1L3 9.6l6.2-.9z"/></svg></button>',
    '<button type="button" aria-label="更多">•••</button>': '<button type="button" aria-label="更多"><svg viewBox="0 0 24 24"><circle cx="5" cy="12" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="19" cy="12" r="1.4"/></svg></button>',
    '<div class="summary-actions">': '<div class="market-range"><span>24h 区间</span><div><i></i></div><small>62,906.1 — 65,182.3</small></div><div class="summary-actions">',
}
for old, new in replacements.items():
    if old not in text:
        raise SystemExit(f'missing patch target: {old}')
    text = text.replace(old, new)

extra_css = r'''
.market-range{margin-left:auto;width:190px;display:flex;flex-direction:column;gap:7px}.market-range>span{font-size:9px;color:var(--muted)}.market-range>div{position:relative;height:3px;border-radius:999px;background:#243247}.market-range>div i{position:absolute;left:62%;top:50%;width:8px;height:8px;border:2px solid #0c131c;border-radius:50%;background:var(--blue);transform:translate(-50%,-50%);box-shadow:0 0 0 1px var(--blue)}.market-range small{font-size:9px;color:var(--muted-2);letter-spacing:.01em}.summary-actions{margin-left:0}.panel-menu svg,.round-action svg,.summary-actions svg{width:16px;height:16px}.order-content{height:calc(100% - 44px);display:flex;flex-direction:column}.order-note{margin-top:auto;padding-top:16px}.account-panel{background:#0d151f}.account-head{background:#101925}@media(min-width:761px){.workspace{grid-template-rows:minmax(470px,1fr) 164px}.empty-row td{height:86px}.empty-state{flex-direction:row;justify-content:center;gap:10px}.empty-state .empty-icon{width:26px;height:26px}.empty-state small{margin-left:4px}.account-table th{height:30px}.account-panel{box-shadow:0 8px 30px rgba(0,0,0,.08)}}@media(max-width:760px){.market-range{display:none}.order-content{height:auto}.order-note{margin-top:11px;padding-top:0}}
'''
text = text.replace('</style>', extra_css + '\n</style>', 1)
path.write_text(text, encoding='utf-8')
print(f'patched {path} ({path.stat().st_size} bytes)')
