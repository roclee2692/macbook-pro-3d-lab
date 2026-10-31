#!/bin/zsh
# 用本机 clang（arm64）汇编测试用例，导出机器码作为单元测试的“金标准”。
set -e
cd "$(dirname "$0")"
OUT=$(mktemp -d)
{ echo ".text"; echo "_cases:"; sed 's/^/  /' isa-cases.txt; } > $OUT/cases.s
clang -c -target arm64-apple-macos13 $OUT/cases.s -o $OUT/cases.o
clang -c -target arm64-apple-macos13 isa-branches.s -o $OUT/br.o
python3 - "$OUT" <<'PY'
import subprocess, sys, json, re
out = sys.argv[1]
def words(obj):
    t = subprocess.check_output(['otool', '-t', obj], text=True)
    ws = []
    for line in t.splitlines()[2:]:
        parts = line.split()
        ws += parts[1:]
    return ws
cases = [l.strip() for l in open('isa-cases.txt') if l.strip()]
w1 = words(out + '/cases.o')
assert len(w1) == len(cases), (len(w1), len(cases))
w2 = words(out + '/br.o')
json.dump({'cases': dict(zip(cases, w1)), 'branches': w2}, open('../tests/clang-golden.json', 'w'), indent=1, ensure_ascii=False)
print('cases', len(cases), 'branch words', len(w2))
PY
