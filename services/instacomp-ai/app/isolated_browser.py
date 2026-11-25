"""Local single-owner headless browser; never attaches to desktop Chrome."""
from __future__ import annotations
import atexit
import fcntl
import json
import os
from pathlib import Path
import resource
import signal
import socket
import subprocess
import sys
import time

ROOT = Path.home() / "Library/Application Support/InstaCompBrowser"
SOCKET = Path("/tmp") / ("instacomp-browser-%s.sock" % os.getuid())
MAX_WIRE = 16 * 1024 * 1024
SERVICE = Path(__file__).resolve().parents[1]
PYTHON_BIN = "/Users/david/workspace/truely_pipeline/venv/bin/python" if os.path.exists("/Users/david/workspace/truely_pipeline/venv/bin/python") else str(SERVICE / ".venv/bin/python")

def _line(stream):
    raw = stream.readline(MAX_WIRE + 1)
    if len(raw) > MAX_WIRE or (raw and not raw.endswith(b"\n")):
        raise RuntimeError("Browser message exceeds limit")
    return json.loads(raw) if raw else None

class BrowserTask:
    """Exclusive task lease. Closing or crashing releases the sole tab."""
    def __init__(self):
        ROOT.mkdir(parents=True, exist_ok=True, mode=0o700)
        deadline = time.monotonic() + 45
        started = False
        self.stream = None
        self.sock = None
        while True:
            self.sock = socket.socket(socket.AF_UNIX)
            self.sock.settimeout(150)
            try:
                watch = json.loads((ROOT / "watchdog.json").read_text())
                os.kill(watch["pid"], 0)
                self.sock.connect(str(SOCKET))
                self.stream = self.sock.makefile("rwb")
                # Handshake before any page action. A restart can race with a
                # stale socket; retry connection only, never replay task actions.
                owner = self.request("status")
                current = json.loads((ROOT / "watchdog.json").read_text())
                os.kill(current["pid"], 0)
                if owner["pid"] != current["child"]:
                    raise ConnectionRefusedError("Stale browser owner")
                break
            except (OSError, RuntimeError, ValueError, KeyError):
                if self.stream is not None:
                    try:
                        self.stream.close()
                    except OSError:
                        pass
                    self.stream = None
                self.sock.close()
                if not started:
                    log = open(ROOT / "broker.log", "ab", buffering=0)
                    subprocess.Popen([PYTHON_BIN, str(Path(__file__)), "--supervise"],
                                     stdin=subprocess.DEVNULL, stdout=log, stderr=log,
                                     start_new_session=True, close_fds=True)
                    log.close()
                    started = True
                if time.monotonic() > deadline:
                    raise RuntimeError("Isolated browser unavailable; desktop fallback disabled")
                time.sleep(.2)
        atexit.register(self.close)

    def request(self, op, **kw):
        self.stream.write(json.dumps(dict(op=op, **kw)).encode() + b"\n")
        self.stream.flush()
        reply = _line(self.stream)
        if reply is None or not reply.get("ok"):
            raise RuntimeError((reply or {}).get("error", "Browser disconnected"))
        return reply["value"]

    def navigate(self, url):
        return self.request("navigate", url=url)

    def js(self, javascript):
        value = self.request("evaluate", javascript=javascript)
        if isinstance(value, str):
            return value
        return json.dumps(value, separators=(",", ":"))

    def close(self):
        if getattr(self, "stream", None):
            try:
                self.request("release")
            except Exception as exc:
                # Preserve cleanup while surfacing failed browser lease release.
                import logging
                logging.getLogger(__name__).warning("Browser lease release failed: %s", exc)
            try:
                self.stream.close()
            except OSError:
                pass
            self.stream = None
        if getattr(self, "sock", None):
            self.sock.close()
            self.sock = None
        atexit.unregister(self.close)

    def __enter__(self):
        return self
    def __exit__(self, *exc):
        self.close()

def capture(url, javascript, wait_seconds=0):
    with BrowserTask() as task:
        task.navigate(url)
        if wait_seconds:
            task.request("wait", seconds=wait_seconds)
        return task.js(javascript)

def _serve():
    from playwright.sync_api import sync_playwright
    resource.setrlimit(resource.RLIMIT_NOFILE, (512, 512))
    os.umask(0o077)
    def stop(*_):
        raise SystemExit(0)
    signal.signal(signal.SIGTERM, stop)
    with sync_playwright() as pw:
        _candidates = [
            "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
            "/Users/david/Library/Caches/ms-playwright/chromium-1248/chrome-mac/Chromium.app/Contents/MacOS/Chromium",
            "/Users/david/Library/Caches/ms-playwright/chromium-1248/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
            "/Users/david/.gemini/users/user1/Library/Caches/ms-playwright/chromium-1248/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
        ]
        _exec_path = next((p for p in _candidates if os.path.exists(p)), None)
        headless = True
        context = pw.chromium.launch_persistent_context(
            str(ROOT / "profile"), headless=headless,
            executable_path=_exec_path,
            accept_downloads=False, timeout=30000, chromium_sandbox=True,
            args=[
                  "--test-type",
                  "--window-position=-5000,-5000",
                  "--window-size=1280,1024",
                  "--no-first-run",
                  "--no-default-browser-check",
                  "--disable-background-networking", "--disable-component-update",
                  "--disable-sync", "--mute-audio", "--renderer-process-limit=2"])
        page = context.pages[0] if context.pages else context.new_page()
        page.set_default_timeout(15000)
        page.set_default_navigation_timeout(30000)
        for extra in context.pages:
            if extra != page:
                extra.close()
        context.on("page", lambda extra: extra.close() if extra != page and not page.is_closed() else None)
        context.add_init_script("window.open = () => null;")
        server = socket.socket(socket.AF_UNIX)
        SOCKET.unlink(missing_ok=True)
        server.bind(str(SOCKET))
        os.chmod(SOCKET, 0o600)
        server.listen(4)
        server.settimeout(1)
        (ROOT / "owner.json").write_text(json.dumps({"pid":os.getpid(), "profile":str(ROOT/"profile"), "headless":True, "max_tabs":1}))
        last = time.monotonic()
        try:
            supervisor_pid = os.getppid()
            while time.monotonic() - last < 900:
                if os.getppid() != supervisor_pid:
                    break
                try:
                    conn, _ = server.accept()
                except socket.timeout:
                    # Chrome can disappear while the broker is idle (for
                    # example after a renderer crash or profile restart).
                    # Treat that as a clean broker restart condition instead
                    # of letting TargetClosedError kill the worker with a
                    # noisy traceback and leave a stale lease behind.
                    try:
                        page.wait_for_timeout(50)
                    except Exception:
                        break
                    continue
                last = time.monotonic()
                (ROOT / "lease-deadline").write_text(str(time.time() + 120))
                conn.settimeout(45)
                stream = conn.makefile("rwb")
                deadline = time.monotonic() + 120
                try:
                    while time.monotonic() < deadline:
                        msg = _line(stream)
                        if msg is None:
                            break
                        op = msg.get("op")
                        try:
                            if op == "release":
                                stream.write(b'{"ok":true,"value":null}\n'); stream.flush()
                                break
                            if page.is_closed():
                                page = context.new_page()
                                page.set_default_timeout(15000)
                                page.set_default_navigation_timeout(30000)
                            if op == "navigate":
                                url = msg["url"]
                                if not url.startswith(("https://", "http://", "about:blank", "data:text/html")):
                                    raise ValueError("Unsupported browser URL")
                                page.goto(url, wait_until="domcontentloaded")
                                value = page.url
                            elif op == "evaluate":
                                value = page.evaluate(msg["javascript"])
                            elif op == "wait":
                                page.wait_for_timeout(max(0,min(float(msg["seconds"]),30))*1000)
                                value = None
                            elif op == "status":
                                value = {"pid":os.getpid(),"pages":len(context.pages),"headless":True,"url":page.url}
                            else:
                                raise ValueError("Unknown browser operation")
                            reply = json.dumps({"ok":True,"value":value}).encode()+b"\n"
                            if len(reply)>MAX_WIRE:
                                raise ValueError("Browser result exceeds limit")
                        except Exception as exc:
                            reply = json.dumps({"ok":False,"error":type(exc).__name__+": "+str(exc)[:400]}).encode()+b"\n"
                        stream.write(reply)
                        stream.flush()
                except (OSError, ValueError, RuntimeError):
                    pass
                finally:
                    (ROOT / "lease-deadline").unlink(missing_ok=True)
                    try:
                        stream.close()
                    except OSError:
                        pass
                    try:
                        conn.close()
                    except OSError:
                        pass
                    # No task leaves an active document or popup behind.
                    for extra in context.pages:
                        if extra != page:
                            extra.close()
                    if not page.is_closed():
                        try:
                            page.goto("about:blank", timeout=5000)
                        except Exception:
                            page.close()
                    last = time.monotonic()
        finally:
            server.close()
            SOCKET.unlink(missing_ok=True)
            context.close()


def _owned_groups():
    try:
        result = subprocess.run(["/bin/ps", "-axo", "pid=,pgid=,rss=,args="],
                                capture_output=True, text=True, timeout=5)
        rows = [row.split(None, 3) for row in result.stdout.splitlines()]
        marker = "--user-data-dir=" + str(ROOT / "profile")
        groups = {int(v[1]) for v in rows if len(v)==4
                  and marker in v[3] and "--type=" not in v[3]
                  and v[3].startswith("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome ")}
        return rows, groups
    except Exception:
        return [], set()

def _kill_groups(groups, sig):
    for group in groups:
        try:
            os.killpg(group, sig)
        except ProcessLookupError:
            pass

def _supervise():
    ROOT.mkdir(parents=True, exist_ok=True, mode=0o700)
    os.chmod(ROOT, 0o700)
    lock = open(ROOT / "owner.lock", "a")
    try:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        return
    try:
        previous = json.loads((ROOT / "watchdog.json").read_text())
        previous_cmd = subprocess.run(
            ["/bin/ps", "-p", str(previous["child"]), "-o", "ppid=,args="],
            capture_output=True, text=True, timeout=5).stdout.strip()
        if (previous_cmd.startswith("1 ") and
            str(Path(__file__)) + " --serve" in previous_cmd):
            _kill_groups({previous["child"]}, signal.SIGTERM)
            time.sleep(.5)
            _kill_groups({previous["child"]}, signal.SIGKILL)
    except Exception:
        pass
    _, stale = _owned_groups()
    _kill_groups(stale, signal.SIGTERM)
    if stale:
        time.sleep(1)
        _kill_groups(stale, signal.SIGKILL)
    (ROOT / "lease-deadline").unlink(missing_ok=True)
    child = subprocess.Popen([str(SERVICE/".venv/bin/python"),str(Path(__file__)),"--serve"],
                             start_new_session=True)
    (ROOT/"watchdog.json").write_text(json.dumps({"pid":os.getpid(),"child":child.pid}))
    def stop(*_):
        raise SystemExit(0)
    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)
    started=time.monotonic()
    groups={child.pid}
    try:
        while child.poll() is None:
            rows, chrome_groups = _owned_groups()
            groups.update(chrome_groups)
            rss=sum(int(v[2]) for v in rows if len(v)==4 and int(v[1]) in groups)
            lease = ROOT / "lease-deadline"
            try:
                overdue = time.time() > float(lease.read_text())
            except (OSError, ValueError):
                overdue = False
            if rss>2048*1024 or time.monotonic()-started>21600 or overdue:
                print(f"Browser resource/lifetime/task limit reached rss_kb={rss} elapsed_seconds={int(time.monotonic()-started)} lease_overdue={overdue}",flush=True)
                break
            time.sleep(1)
    finally:
        _kill_groups(groups,signal.SIGTERM)
        try:
            child.wait(timeout=5)
        except subprocess.TimeoutExpired:
            pass
        time.sleep(.5)
        _kill_groups(groups,signal.SIGKILL)
        SOCKET.unlink(missing_ok=True)
        (ROOT/"lease-deadline").unlink(missing_ok=True)
        lock.close()

if __name__ == "__main__":
    _serve() if "--serve" in sys.argv else _supervise()
