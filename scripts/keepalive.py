#!/usr/bin/env python3
"""
PMS Keepalive Server — keeps Next.js alive and serves as a stable frontend.
If Next.js dies, it auto-restarts. Serves cached HTML as fallback.
"""
import subprocess, time, os, threading, json, signal, sys

PORT = 3000
NEXT_DIR = "/home/z/my-project"
next_proc = None
cached_html = None

def start_next():
    global next_proc
    next_proc = subprocess.Popen(
        ["node", ".next/standalone/server.js"],
        cwd=NEXT_DIR,
        stdout=open(f"{NEXT_DIR}/next-out.log", "a"),
        stderr=open(f"{NEXT_DIR}/next-err.log", "a"),
        env={**os.environ, "NODE_ENV": "production", "PORT": "3001"}
    )
    return next_proc

def monitor_next():
    global next_proc
    while True:
        if next_proc and next_proc.poll() is not None:
            print(f"[{time.strftime('%H:%M:%S')}] Next.js died (code {next_proc.returncode}), restarting...")
            time.sleep(2)
            start_next()
        time.sleep(3)

# Start Next.js on port 3001 (internal)
print(f"[{time.strftime('%H:%M:%S')}] Starting Next.js on port 3001...")
start_next()

# Cache the HTML shell
time.sleep(5)
try:
    import urllib.request
    for attempt in range(10):
        try:
            cached_html = urllib.request.urlopen("http://127.0.0.1:3001/").read()
            print(f"[{time.strftime('%H:%M:%S')}] Cached HTML shell ({len(cached_html)} bytes)")
            break
        except:
            time.sleep(2)
except:
    cached_html = b"<html><body><h1>PMS Loading...</h1></body></html>"

# Start monitor thread
threading.Thread(target=monitor_next, daemon=True).start()

# Simple proxy server on port 3000
from http.server import HTTPServer, BaseHTTPRequestHandler

class ProxyHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        self._proxy()
    
    def do_POST(self):
        self._proxy()
    
    def do_PUT(self):
        self._proxy()
    
    def do_DELETE(self):
        self._proxy()
    
    def _proxy(self):
        import urllib.request, urllib.error
        target = f"http://127.0.0.1:3001{self.path}"
        
        # Read body if present
        content_length = int(self.headers.get('Content-Length', 0))
        body = self.rfile.read(content_length) if content_length > 0 else None
        
        try:
            req = urllib.request.Request(target, data=body, method=self.command)
            # Forward headers
            for key, val in self.headers.items():
                if key.lower() not in ('host', 'content-length'):
                    req.add_header(key, val)
            
            resp = urllib.request.urlopen(req, timeout=30)
            self.send_response(resp.status)
            for key, val in resp.getheaders():
                if key.lower() not in ('transfer-encoding', 'connection'):
                    self.send_header(key, val)
            self.end_headers()
            self.wfile.write(resp.read())
            
        except urllib.error.HTTPError as e:
            self.send_response(e.code)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({"error": str(e)}).encode())
        except Exception as e:
            # Fallback to cached HTML for the main page
            if self.path == '/' and cached_html:
                self.send_response(200)
                self.send_header('Content-Type', 'text/html; charset=utf-8')
                self.send_header('Content-Length', len(cached_html))
                self.end_headers()
                self.wfile.write(cached_html)
            else:
                self.send_response(502)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({"error": "Next.js starting...", "retry": True}).encode())
    
    def log_message(self, format, *args):
        print(f"[{time.strftime('%H:%M:%S')}] {args[0]}")

print(f"[{time.strftime('%H:%M:%S')}] Proxy listening on :{PORT} -> Next.js on :3001")
server = HTTPServer(('0.0.0.0', PORT), ProxyHandler)
server.serve_forever()