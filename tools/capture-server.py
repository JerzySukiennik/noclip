# Dev-only: receives frames the running page POSTs, writes them to shots/.
import base64, http.server, os, sys

OUT = os.path.join(os.path.dirname(__file__), '..', 'shots')

class H(http.server.BaseHTTPRequestHandler):
    def _cors(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Headers', '*')
        self.send_header('Access-Control-Allow-Methods', 'POST, OPTIONS')

    def do_OPTIONS(self):
        self.send_response(204); self._cors(); self.end_headers()

    def do_POST(self):
        n = int(self.headers.get('Content-Length', 0))
        body = self.rfile.read(n).decode('utf-8', 'replace')
        name, _, data = body.partition('|')
        name = ''.join(c for c in name if c.isalnum() or c in '-_') or 'frame'
        if ',' in data:
            data = data.split(',', 1)[1]
        path = os.path.join(OUT, name + '.jpg')
        with open(path, 'wb') as f:
            f.write(base64.b64decode(data))
        self.send_response(200); self._cors(); self.end_headers()
        self.wfile.write(b'ok')
        print('wrote', path, os.path.getsize(path), 'bytes', flush=True)

    def log_message(self, *a):
        pass

http.server.HTTPServer(('127.0.0.1', int(sys.argv[1] if len(sys.argv) > 1 else 8712)), H).serve_forever()
