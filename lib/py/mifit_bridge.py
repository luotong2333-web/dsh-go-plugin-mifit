#!/usr/bin/env python3
"""Sidecar process for the local-mifit dsh-go plugin.

The plugin runs inside the DSH engine on the phone and cannot do three jobs
itself: install the ``mifit`` SDK, wait for a Xiaomi QR login, and pull data
from the Xiaomi cloud. This script does those jobs and reports progress in
small JSON files under ``<home>/state``; the plugin only reads those files.

Nothing here prints a token, a cookie, a passToken or any other session field.
``mifit`` writes the session itself (``~/.mifit/session.json``, owner-only) and
these state files hold status words, counts and file names only.
"""

from __future__ import annotations

import argparse
import io
import json
import os
import subprocess
import sys
import time
from datetime import date, timedelta
from pathlib import Path

DEFAULT_DOMAINS = (
    "steps",
    "sleep",
    "heart_rate_daily",
    "spo2_daily",
    "stress_daily",
    "weight",
    "workouts",
    "profile",
)
PIP_TIMEOUT_S = 900
FETCH_TIMEOUT_S = 240
PROFILE_DOMAIN = "profile"
QR_BOX_SIZE = 4


def now() -> str:
    offset = time.strftime("%z")
    if len(offset) == 5:
        offset = offset[:3] + ":" + offset[3:]
    return time.strftime("%Y-%m-%dT%H:%M:%S") + offset


def write_json(path: Path, payload: dict) -> None:
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        temp = path.with_name(path.name + ".tmp")
        temp.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
        os.replace(temp, path)
    except OSError:
        pass


def short_error(exc: BaseException) -> str:
    text = str(exc).strip().replace("\n", " ")
    name = type(exc).__name__
    return f"{name}: {text[:120]}" if text else name


def site_on_path(home: Path) -> bool:
    site = home / "site"
    if not (site / "mifit").is_dir():
        return False
    sys.path.insert(0, str(site))
    return True


def imports_ok(site: Path) -> bool:
    env = dict(os.environ)
    env["PYTHONPATH"] = str(site)
    try:
        proc = subprocess.run(
            [sys.executable, "-c", "import mifit, qrcode, requests, cryptography"],
            capture_output=True,
            text=True,
            timeout=180,
            env=env,
        )
    except Exception:
        return False
    return proc.returncode == 0


def cmd_setup(home: Path) -> int:
    site = home / "site"
    state = home / "state"
    site.mkdir(parents=True, exist_ok=True)
    write_json(state / "setup.json", {"status": "running", "startedAt": now()})
    # A phone whose python3 has no pip yet gets one from the standard library.
    try:
        probe = subprocess.run(
            [sys.executable, "-m", "pip", "--version"], capture_output=True, timeout=60
        )
        if probe.returncode != 0:
            subprocess.run(
                [sys.executable, "-m", "ensurepip", "--upgrade"],
                capture_output=True,
                timeout=180,
            )
    except Exception:
        pass
    indexes = [
        os.environ.get("DSH_MIFIT_INDEX", ""),
        "",
        "https://pypi.org/simple",
        "https://pypi.tuna.tsinghua.edu.cn/simple",
    ]
    seen = set()
    message = ""
    for index in indexes:
        if index in seen:
            continue
        seen.add(index)
        command = [
            sys.executable,
            "-m",
            "pip",
            "install",
            "--disable-pip-version-check",
            "--no-input",
            "--upgrade",
            "--target",
            str(site),
        ]
        if index:
            command += ["--index-url", index]
        command.append("mifit")
        try:
            proc = subprocess.run(
                command, capture_output=True, text=True, timeout=PIP_TIMEOUT_S
            )
        except Exception as exc:
            message = short_error(exc)
            continue
        if proc.returncode != 0:
            lines = [line for line in (proc.stderr or "").strip().splitlines() if line.strip()]
            message = lines[-1][:140] if lines else "pip 安装失败"
            continue
        if imports_ok(site):
            write_json(
                state / "setup.json",
                {"status": "ok", "finishedAt": now(), "index": index or "default"},
            )
            return 0
        message = "装好了但导入失败"
    write_json(
        state / "setup.json",
        {"status": "failed", "finishedAt": now(), "message": message or "安装失败"},
    )
    return 1


def qr_png(content: str) -> bytes:
    import qrcode
    from qrcode.image.pure import PyPNGImage

    code = qrcode.QRCode(
        error_correction=qrcode.constants.ERROR_CORRECT_L,
        border=2,
        box_size=QR_BOX_SIZE,
        image_factory=PyPNGImage,
    )
    code.add_data(content)
    code.make(fit=True)
    out = io.BytesIO()
    code.make_image().save(out)
    return out.getvalue()


def cmd_login(home: Path) -> int:
    state = home / "state"
    if not site_on_path(home):
        write_json(
            state / "login.json",
            {"status": "failed", "finishedAt": now(), "message": "运行环境还没准备好"},
        )
        return 1
    write_json(state / "login.json", {"status": "starting", "startedAt": now()})
    try:
        import requests
        from mifit.auth.qr import (
            exchange_sts,
            new_device_id,
            poll_qr_login,
            request_qr_login,
        )
        from mifit.auth.session import save_session
        from mifit.errors import MiFitError, NotificationRequiredError
        from mifit.region import SID
    except Exception as exc:
        write_json(
            state / "login.json",
            {
                "status": "failed",
                "finishedAt": now(),
                "message": "依赖不完整：" + short_error(exc),
            },
        )
        return 1

    http = requests.Session()
    device_id = new_device_id()
    try:
        challenge = request_qr_login(http, SID, device_id=device_id)
    except Exception as exc:
        write_json(
            state / "login.json",
            {
                "status": "failed",
                "finishedAt": now(),
                "message": "获取二维码失败：" + short_error(exc),
            },
        )
        return 1
    try:
        (state / "qr.png").write_bytes(qr_png(challenge.login_url))
    except Exception as exc:
        write_json(
            state / "login.json",
            {
                "status": "failed",
                "finishedAt": now(),
                "message": "二维码生成失败：" + short_error(exc),
            },
        )
        return 1
    write_json(
        state / "login.json",
        {"status": "pending", "startedAt": now(), "qrAt": now(), "message": "等待扫码"},
    )

    try:
        result = poll_qr_login(challenge, http, device_id=device_id)
        session = exchange_sts(result, SID, http, device_id=device_id)
        save_session(session)
    except NotificationRequiredError:
        write_json(
            state / "login.json",
            {"status": "confirm", "finishedAt": now(), "message": "小米要求安全确认"},
        )
        return 1
    except requests.ReadTimeout:
        write_json(
            state / "login.json",
            {"status": "expired", "finishedAt": now(), "message": "二维码过期"},
        )
        return 1
    except requests.RequestException as exc:
        write_json(
            state / "login.json",
            {
                "status": "failed",
                "finishedAt": now(),
                "message": "网络请求失败（" + type(exc).__name__ + "）",
            },
        )
        return 1
    except MiFitError as exc:
        write_json(
            state / "login.json",
            {"status": "failed", "finishedAt": now(), "message": str(exc)[:140]},
        )
        return 1
    except Exception as exc:
        write_json(
            state / "login.json",
            {"status": "failed", "finishedAt": now(), "message": type(exc).__name__},
        )
        return 1

    # The QR file stays: the sign-in panel keeps drawing it under a caption that
    # says it is no longer valid, so the panel never collapses into blank space.
    write_json(
        state / "login.json",
        {"status": "succeeded", "finishedAt": now(), "message": "登录成功"},
    )
    return 0


def cmd_fetch(home: Path, data: Path, days: int, domains: list[str]) -> int:
    state = home / "state"
    site = home / "site"
    if not (site / "mifit").is_dir():
        write_json(
            state / "fetch.json",
            {"status": "failed", "finishedAt": now(), "message": "运行环境还没准备好"},
        )
        return 1
    data.mkdir(parents=True, exist_ok=True)
    today = date.today()
    start = today - timedelta(days=max(1, days) - 1)
    env = dict(os.environ)
    env["PYTHONPATH"] = str(site) + (
        (os.pathsep + env["PYTHONPATH"]) if env.get("PYTHONPATH") else ""
    )
    done: list[str] = []
    failed: list[str] = []
    write_json(
        state / "fetch.json",
        {
            "status": "running",
            "startedAt": now(),
            "days": days,
            "domains": domains,
            "done": [],
            "failed": [],
        },
    )
    for domain in domains:
        target = data / f"{domain}.json"
        if domain == PROFILE_DOMAIN:
            command = [sys.executable, "-m", "mifit.cli", "profile", "--json", str(target)]
        else:
            command = [
                sys.executable,
                "-m",
                "mifit.cli",
                "export",
                domain,
                "--from",
                start.isoformat(),
                "--to",
                today.isoformat(),
                "--json",
                str(target),
            ]
        ok = False
        try:
            proc = subprocess.run(
                command, capture_output=True, text=True, timeout=FETCH_TIMEOUT_S, env=env
            )
            ok = proc.returncode == 0 and target.exists()
        except Exception:
            ok = False
        if ok:
            done.append(domain)
        else:
            failed.append(domain)
        write_json(
            state / "fetch.json",
            {
                "status": "running",
                "startedAt": now(),
                "days": days,
                "domains": domains,
                "done": done,
                "failed": failed,
            },
        )
    status = "ok" if not failed else ("partial" if done else "failed")
    write_json(
        state / "fetch.json",
        {"status": status, "finishedAt": now(), "days": days, "done": done, "failed": failed},
    )
    return 0 if status == "ok" else 1


def read_state(home: Path, name: str):
    try:
        return json.loads((home / "state" / name).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None


def cmd_status(home: Path, data: Path) -> int:
    session = Path.home() / ".mifit" / "session.json"
    payload = {
        "runtimeReady": (home / "site" / "mifit").is_dir(),
        "sessionFile": session.exists(),
        "dataDir": str(data),
        "dataFiles": sorted(p.name for p in data.glob("*.json")) if data.is_dir() else [],
        "setup": read_state(home, "setup.json"),
        "login": read_state(home, "login.json"),
        "fetch": read_state(home, "fetch.json"),
    }
    print(json.dumps(payload, ensure_ascii=False, indent=2))
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="mifit sidecar for the local-mifit dsh-go plugin")
    parser.add_argument("command", choices=["setup", "login", "fetch", "status"])
    parser.add_argument("--home", required=True)
    parser.add_argument("--data", default="")
    parser.add_argument("--days", type=int, default=7)
    parser.add_argument("--domains", default=",".join(DEFAULT_DOMAINS))
    args = parser.parse_args(argv)
    home = Path(args.home).expanduser()
    data = Path(args.data).expanduser() if args.data else home / "data"
    if args.command == "setup":
        return cmd_setup(home)
    if args.command == "login":
        return cmd_login(home)
    if args.command == "fetch":
        domains = [item.strip() for item in args.domains.split(",") if item.strip()]
        return cmd_fetch(home, data, args.days, domains or list(DEFAULT_DOMAINS))
    return cmd_status(home, data)


if __name__ == "__main__":
    raise SystemExit(main())
