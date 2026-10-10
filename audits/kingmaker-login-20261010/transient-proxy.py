from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
import urllib.request, urllib.error, time, json, threading
state = {"pendingRequests": 0, "jobStatusCompleted": False}
lock = threading.Lock()
class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args): pass
    def do_GET(self): self.proxy()
    def do_POST(self): self.proxy()
    def reply(self, status, body, headers=None):
        self.send_response(status)
        for k,v in (headers or {}).items():
            if k.lower() not in {"content-length", "transfer-encoding", "connection"}: self.send_header(k,v)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers(); self.wfile.write(body)
    def proxy(self):
        if self.path == "/__audit":
            return self.reply(200, json.dumps(state).encode(), {"Content-Type":"application/json"})
        if self.path.startswith("/api/account/seller/instacomp-pending?"):
            with lock:
                state["pendingRequests"] += 1
                first = state["pendingRequests"] == 1
            if first:
                return self.reply(502,b'{"error":"Fixture gateway reconnect"}', {"Content-Type":"application/json"})
        job = self.path.startswith("/api/account/seller/inventory/instacomp-job-status")
        if job: time.sleep(8)
        body = self.rfile.read(int(self.headers.get("Content-Length",0))) if self.command == "POST" else None
        headers = {k:v for k,v in self.headers.items() if k.lower() not in {"host","connection","content-length"}}
        req = urllib.request.Request("http://127.0.0.1:3003"+self.path, data=body, method=self.command, headers=headers)
        try:
            with urllib.request.urlopen(req,timeout=20) as r:
                data=r.read(); status=r.status; hs=dict(r.headers)
        except urllib.error.HTTPError as r:
            data=r.read(); status=r.code; hs=dict(r.headers)
        except Exception:
            return self.reply(503,b'{"error":"fixture upstream unavailable"}', {"Content-Type":"application/json"})
        if job: state["jobStatusCompleted"] = True
        try: self.reply(status,data,hs)
        except BrokenPipeError: pass
ThreadingHTTPServer(("127.0.0.1",3004), Handler).serve_forever()
