#!/usr/bin/env python3
"""workcase-996e207a 计划步骤 1：跨面指称现状清点（可复现）
用法：python3 census.py   （在仓库根目录运行）
口径：短标识 = 8 位小写十六进制；类型前缀 = workcase|spark|adr|pitfall|friction|research|norm|goal
"""
import re, subprocess, glob
PRE = r'(?:workcase|spark|adr|pitfall|friction|research|norm|goal)'
pref = re.compile(r'(?<![0-9a-f-])' + PRE + r'-([0-9a-f]{8})(?![0-9a-f])')
bare = re.compile(r'(?<![0-9a-f])[0-9a-f]{8}(?![0-9a-f])')
pathish = re.compile(r'(?:ldvh-base/|specs/|plugin/|lib/|test/|docs/)\S+')

def surface(label, files):
    hits = {'pref': 0, 'bare': 0, 'pref_lines': 0, 'bare_lines': 0}
    for f in files:
        for line in open(f, encoding='utf-8'):
            free = pref.sub(' ', line)
            p = pref.findall(line); b = bare.findall(free)
            hits['pref'] += len(p); hits['bare'] += len(b)
            hits['pref_lines'] += bool(p); hits['bare_lines'] += bool(b)
    print(f"[{label}] prefixed={hits['pref']} bare={hits['bare']} "
          f"(prefixed 行 {hits['pref_lines']} / bare 行 {hits['bare_lines']})")

# 面 1：规范正文
surface('specs', sorted(glob.glob('specs/**/*.md', recursive=True)))
# 面 2：事实源正文（含本单自身）
surface('ldvh-base', sorted(glob.glob('ldvh-base/**/*.md', recursive=True)))

# 面 4：提交消息（git log -60），按「路径片段 / 正文独立指称」拆分
raw = subprocess.run(['git', 'log', '-60', '--format=%B'], capture_output=True, text=True, check=True).stdout
r = {'path_pref': 0, 'path_bare': 0, 'body_pref': {}, 'body_bare': {}}
for line in raw.splitlines():
    ispath = bool(pathish.search(line))
    free = pref.sub(' ', line)
    for m in pref.finditer(line):
        if ispath: r['path_pref'] += 1
        else: r['body_pref'][m.group(0)] = r['body_pref'].get(m.group(0), 0) + 1
    for m in bare.finditer(free):
        if ispath: r['path_bare'] += 1
        else: r['body_bare'][m.group(0)] = r['body_bare'].get(m.group(0), 0) + 1
print(f"[git log -60] 路径片段: prefixed={r['path_pref']} bare={r['path_bare']}")
print(f"[git log -60] 正文独立指称: prefixed={sum(r['body_pref'].values())}（去重 {len(r['body_pref'])}） "
      f"bare={sum(r['body_bare'].values())}（去重 {len(r['body_bare'])}）")

# 可解析性：正文裸标识能否在事实源中按 object_uid 前缀定位
def resolvable(short):
    return subprocess.run(['grep', '-rlq', f'^object_uid: {short}', 'ldvh-base', '--include=*.md']).returncode == 0
for surface_label, pat in [('specs', glob.glob('specs/**/*.md', recursive=True))]:
    bad = set()
    allsh = set()
    for f in pat:
        for line in open(f, encoding='utf-8'):
            for m in bare.finditer(pref.sub(' ', line)):
                allsh.add(m.group(0))
    bad = sorted(s for s in allsh if not resolvable(s))
    print(f"[specs 不可解析] {len(bad)}: {bad}")
