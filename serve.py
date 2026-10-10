#!/usr/bin/env python3
"""Local preview server for the case study — sends no-cache headers so you always see the latest build.
Usage:  python3 serve.py   then open http://localhost:8080  (Ctrl+C to stop)"""
import http.server, os, socketserver, sys
os.chdir(os.path.dirname(os.path.abspath(__file__)))
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8080
class NoCache(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, must-revalidate')
        super().end_headers()
socketserver.TCPServer.allow_reuse_address = True
try:
    with socketserver.TCPServer(('', PORT), NoCache) as httpd:
        print(f'Serving {os.getcwd()} at http://localhost:{PORT}')
        httpd.serve_forever()
except OSError:
    print(f'Port {PORT} is already in use (probably an older preview server). Stop it, or run: python3 serve.py 8081')
