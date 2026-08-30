# Stamp every relative ES-module import with a version query.
#
# GitHub Pages serves the repo directly with a long cache TTL and no fingerprinting,
# so after a deploy a browser happily runs a mix of new and old modules - which looks
# like a bug in whatever changed. Changing the URL is the only reliable cache bust.
import os, re, subprocess, sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
IMPORT_RE = re.compile(r"""(from\s+['"])(\.{1,2}/[^'"?]+?\.js)(\?v=[^'"]*)?(['"])""")
SRC_RE = re.compile(r"""(src=")(js/[^"?]+?\.js)(\?v=[^"]*)?(")""")


def version():
    try:
        sha = subprocess.run(['git', 'rev-parse', '--short', 'HEAD'], cwd=ROOT,
                             capture_output=True, text=True).stdout.strip()
    except Exception:
        sha = ''
    newest = 0
    for base, _, files in os.walk(os.path.join(ROOT, 'js')):
        for f in files:
            if f.endswith('.js'):
                newest = max(newest, os.path.getmtime(os.path.join(base, f)))
    return f"{sha or 'v'}{int(newest)}"


def main():
    v = sys.argv[1] if len(sys.argv) > 1 else version()
    changed = []
    for base, dirs, files in os.walk(ROOT):
        dirs[:] = [d for d in dirs if d not in ('.git', 'shots', 'tools') and not re.match(r'^v\d', d)]
        for f in files:
            if not f.endswith(('.js', '.html')):
                continue
            p = os.path.join(base, f)
            src = open(p, encoding='utf-8').read()
            out = IMPORT_RE.sub(lambda m: m.group(1) + m.group(2) + '?v=' + v + m.group(4), src)
            out = SRC_RE.sub(lambda m: m.group(1) + m.group(2) + '?v=' + v + m.group(4), out)
            if out != src:
                open(p, 'w', encoding='utf-8').write(out)
                changed.append(os.path.relpath(p, ROOT))
    print('version', v, '- stamped', len(changed), 'files')


main()
