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
}
for old, new in replacements.items():
    if old not in text:
        raise SystemExit(f'missing patch target: {old}')
    text = text.replace(old, new)
path.write_text(text, encoding='utf-8')
print(f'patched {path} ({path.stat().st_size} bytes)')
