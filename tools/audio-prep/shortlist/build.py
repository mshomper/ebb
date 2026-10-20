import re, json, html, sys
src, out = sys.argv[1], sys.argv[2]
lines = open(src, encoding='utf-8').read().split('\n')
sections = []; cur = None; sub = None; gaps = []; in_gaps = False
ent = re.compile(r'^- \[ \] \*\*(?P<title>.+?)\*\* by \*(?P<author>.+?)\*, (?P<meta>.+?)\. (?P<url>https://freesound\.org/people/[^/]+/sounds/(?P<id>\d+)/) \. Why: (?P<why>.+?)(?: Listen for: (?P<listen>.+?))? Save as: (?P<save>\S+)\s*$')
for ln in lines:
    if ln.startswith('## '):
        title = ln[3:].strip()
        in_gaps = title.lower().startswith('gaps')
        if in_gaps: continue
        m = re.match(r'(.+?) \(folder `(.+?)`\)', title)
        cur = {'title': m.group(1) if m else title, 'folder': m.group(2) if m else '', 'needs': '', 'intro': [], 'items': []}
        sections.append(cur); sub = None; continue
    if in_gaps:
        if ln.startswith('- '): gaps.append(ln[2:].strip())
        elif ln.strip() and not ln.startswith('Groups'): gaps.append(ln.strip())
        continue
    if cur is None: continue
    if ln.startswith('Needs:'): cur['needs'] = ln[6:].strip(); continue
    m = ent.match(ln)
    if m:
        d = m.groupdict(); d['sub'] = sub; cur['items'].append(d); continue
    if re.match(r'^[A-Z][^.]{0,60}:$', ln.strip()): sub = ln.strip()[:-1]; continue
    if ln.strip() and not ln.startswith('---') and not ln.startswith('- '): cur['intro'].append(ln.strip())
n = sum(len(s['items']) for s in sections)
assert n == 110, n
def md_inline(t):
    t = html.escape(t)
    t = re.sub(r'\*\*(.+?)\*\*', r'<b>\1</b>', t)
    t = re.sub(r'`(.+?)`', r'<code>\1</code>', t)
    t = re.sub(r'(?<![\w*])\*(?!\s)(.+?)(?<!\s)\*', r'<i>\1</i>', t)
    return t
data = json.dumps(sections, ensure_ascii=False)
page = open(sys.argv[3], encoding='utf-8').read()
page = page.replace('/*DATA*/null', data).replace('<!--GAPS-->', '\n'.join(f'<li>{md_inline(g)}</li>' for g in gaps)).replace('{{COUNT}}', str(n))
open(out, 'w', encoding='utf-8').write(page)
print(n, 'entries,', len(sections), 'sections,', len(gaps), 'gap notes')
