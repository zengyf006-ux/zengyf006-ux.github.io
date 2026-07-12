#!/usr/bin/env python3
from __future__ import annotations

import importlib.util
import os
from pathlib import Path
import signal
import sys
from typing import Any, Callable


def load_runner() -> Any:
    path = Path(__file__).with_name('web-quality.py')
    spec = importlib.util.spec_from_file_location('atlas_web_quality', path)
    if spec is None or spec.loader is None:
        raise RuntimeError('Unable to load browser quality runner')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def timeout_handler(_signum: int, _frame: Any) -> None:
    raise TimeoutError('Browser quality gate exceeded its five-minute execution budget')


def phase(name: str, function: Callable[..., Any]) -> Callable[..., Any]:
    def wrapped(*args: Any, **kwargs: Any) -> Any:
        print(f'[web-quality] {name}', flush=True)
        return function(*args, **kwargs)
    return wrapped


def main() -> int:
    exact_head = os.environ.get('ATLAS_HEAD_SHA')
    if exact_head:
        os.environ['GITHUB_SHA'] = exact_head

    runner = load_runner()

    def safe_service_worker_control(page: Any) -> bool:
        if not page.evaluate("() => 'serviceWorker' in navigator"):
            return False
        ready = page.evaluate(
            """
            async () => Promise.race([
              navigator.serviceWorker.ready.then(() => true),
              new Promise((resolve) => setTimeout(() => resolve(false), 10_000)),
            ])
            """
        )
        if not ready:
            return False
        if page.evaluate('() => navigator.serviceWorker.controller !== null'):
            return True
        page.reload(wait_until='domcontentloaded', timeout=20_000)
        runner.wait_for_app(page)
        try:
            page.wait_for_function(
                '() => navigator.serviceWorker.controller !== null',
                timeout=10_000,
            )
        except Exception:
            return False
        return bool(page.evaluate('() => navigator.serviceWorker.controller !== null'))

    runner.ensure_service_worker_control = safe_service_worker_control
    runner.performance_metrics = phase('performance', runner.performance_metrics)
    runner.accessibility_audit = phase('accessibility', runner.accessibility_audit)
    runner.run_paper_flow = phase('paper-flow', runner.run_paper_flow)
    runner.run_offline_recovery = phase('offline-recovery', runner.run_offline_recovery)
    runner.capture_viewports = phase('four-viewports', runner.capture_viewports)

    signal.signal(signal.SIGALRM, timeout_handler)
    signal.alarm(300)
    try:
        return int(runner.main())
    finally:
        signal.alarm(0)


if __name__ == '__main__':
    sys.exit(main())
