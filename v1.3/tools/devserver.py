# Dev static server. Browsers keep ES modules in an in-process cache that ignores
# no-store, so every relative import gets stamped with the newest mtime in js/.
import http.server, os, re, sys, io

ROOT = os.path.abspath(sys.argv[2] if len(sys.argv) > 2 else os.path.join(os.path.dirname(__file__), '..'))
IMPORT_RE = re.compile(rb"(from\s+['\"])(\.{1,2}/[^'\"]+?\.js)(['\"])")
SRC_RE = re.compile(rb"(src=\")(js/[^\"]+?\.js)(\")")


def stamp():
    newest = 0
    for base, _, files in os.walk(os.path.join(ROOT, 'js')):
        for f in files:
            if f.endswith('.js'):
                newest = max(newest, os.path.getmtime(os.path.join(base, f)))
    return str(int(newest))


class H(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k):
        super().__init__(*a, directory=ROOT, **k)

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate')
        super().end_headers()

    def send_head(self):
        if self.path.split('?')[0] == '/__probe.js':
            body = open(os.path.join(os.path.dirname(__file__), 'probe.js'), 'rb').read()
            self.send_response(200)
            self.send_header('Content-type', 'text/javascript')
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            return io.BytesIO(body)
        path = self.translate_path(self.path)
        if os.path.isdir(path):
            path = os.path.join(path, 'index.html')
        if not os.path.isfile(path) or not path.endswith(('.js', '.html')):
            return super().send_head()
        v = stamp().encode()
        with open(path, 'rb') as f:
            body = f.read()
        body = IMPORT_RE.sub(lambda m: m.group(1) + m.group(2) + b'?v=' + v + m.group(3), body)
        body = SRC_RE.sub(lambda m: m.group(1) + m.group(2) + b'?v=' + v + m.group(3), body)
        self.send_response(200)
        self.send_header('Content-type', 'text/javascript' if path.endswith('.js') else 'text/html')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        return io.BytesIO(body)


http.server.HTTPServer(('127.0.0.1', int(sys.argv[1])), H).serve_forever()
