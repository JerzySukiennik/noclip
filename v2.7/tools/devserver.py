# Dev static server. Browsers keep ES modules in an in-process cache that ignores
# no-store, so every relative import gets stamped with the newest mtime in js/.
import http.server, os, re, sys, io

ROOT = os.path.abspath(sys.argv[2] if len(sys.argv) > 2 else os.path.join(os.path.dirname(__file__), '..'))
IMPORT_RE = re.compile(rb"(from\s+['\"])(\.{1,2}/[^'\"?]+?\.js)(\?v=[^'\"]*)?(['\"])")
SRC_RE = re.compile(rb"(src=\")(js/[^\"?]+?\.js)(\?v=[^\"]*)?(\")")


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
        if self.path.split('?')[0] in ('/__probe.js', '/__vocals.js'):
            name = 'probe.js' if '__probe' in self.path else 'analyze-vocals.js'
            body = open(os.path.join(os.path.dirname(__file__), name), 'rb').read()
            self.send_response(200)
            self.send_header('Content-type', 'text/javascript')
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            return io.BytesIO(body)
        path = self.translate_path(self.path)
        if os.path.isdir(path):
            path = os.path.join(path, 'index.html')
        if not os.path.isfile(path):
            return super().send_head()
        if not path.endswith(('.js', '.html')):
            # Media needs byte ranges or the browser cannot seek, which silently
            # breaks every start/end slice in the music manifest.
            return self.send_ranged(path)
        v = stamp().encode()
        with open(path, 'rb') as f:
            body = f.read()
        body = IMPORT_RE.sub(lambda m: m.group(1) + m.group(2) + b'?v=' + v + m.group(4), body)
        body = SRC_RE.sub(lambda m: m.group(1) + m.group(2) + b'?v=' + v + m.group(4), body)
        self.send_response(200)
        self.send_header('Content-type', 'text/javascript' if path.endswith('.js') else 'text/html')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        return io.BytesIO(body)


    def guess(self, path):
        ext = os.path.splitext(path)[1].lower()
        return {
            '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav',
            '.m4a': 'audio/mp4', '.json': 'application/json', '.css': 'text/css',
        }.get(ext, self.guess_type(path))

    def send_ranged(self, path):
        size = os.path.getsize(path)
        ctype = self.guess(path)
        rng = self.headers.get('Range')
        f = open(path, 'rb')
        if not rng:
            self.send_response(200)
            self.send_header('Content-type', ctype)
            self.send_header('Accept-Ranges', 'bytes')
            self.send_header('Content-Length', str(size))
            self.end_headers()
            return f
        m = re.match(r'bytes=(\d*)-(\d*)', rng.strip())
        if not m:
            f.close()
            self.send_error(416)
            return None
        start = int(m.group(1)) if m.group(1) else 0
        end = int(m.group(2)) if m.group(2) else size - 1
        end = min(end, size - 1)
        if start > end:
            f.close()
            self.send_error(416)
            return None
        f.seek(start)
        self.send_response(206)
        self.send_header('Content-type', ctype)
        self.send_header('Accept-Ranges', 'bytes')
        self.send_header('Content-Range', 'bytes %d-%d/%d' % (start, end, size))
        self.send_header('Content-Length', str(end - start + 1))
        self.end_headers()
        return io.BytesIO(f.read(end - start + 1))


http.server.HTTPServer(('127.0.0.1', int(sys.argv[1])), H).serve_forever()
