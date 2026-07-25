#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import shutil
import sys
import time
import traceback
from typing import Any
from urllib.parse import urlparse

from playwright.sync_api import Browser, BrowserContext, Page, Playwright, sync_playwright

VIEWPORTS: dict[str, dict[str, int]] = {
    "desktop-1440x900": {"width": 1440, "height": 900},
    "laptop-1024x768": {"width": 1024, "height": 768},
    "tablet-768x1024": {"width": 768, "height": 1024},
    "mobile-390x844": {"width": 390, "height": 844},
}

PERFORMANCE_BUDGETS = {
    "firstContentfulPaintMs": 3000,
    "loadEventMs": 5000,
    "resourceTransferBytes": 2_000_000,
    "javascriptEncodedBytes": 750_000,
    "cssEncodedBytes": 250_000,
    "domNodes": 1200,
    "cumulativeLayoutShift": 0.25,
    "longTaskDurationMs": 1000,
}

INTERACTIVE_AX_ROLES = {
    "button", "checkbox", "combobox", "link", "listbox", "menuitem", "radio",
    "searchbox", "slider", "spinbutton", "switch", "tab", "textbox",
}


class QualityGate:
    def __init__(self) -> None:
        self.failures: list[str] = []

    def check(self, condition: bool, message: str) -> None:
        if not condition:
            self.failures.append(message)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="ATLAS X browser quality gate")
    parser.add_argument("--base-url", default="http://127.0.0.1:4173/")
    parser.add_argument("--output", default="ci-evidence/g7")
    return parser.parse_args()


def chrome_executable() -> str:
    candidates = [
        os.environ.get("CHROME_PATH"),
        shutil.which("google-chrome-stable"),
        shutil.which("google-chrome"),
        shutil.which("chromium"),
        shutil.which("chromium-browser"),
    ]
    for candidate in candidates:
        if candidate and Path(candidate).is_file():
            return candidate
    raise RuntimeError("No system Chrome/Chromium executable was found")


def install_network_boundaries(context: BrowserContext, base_url: str) -> None:
    base = urlparse(base_url)
    allowed_origin = f"{base.scheme}://{base.netloc}"

    def route_request(route: Any) -> None:
        parsed = urlparse(route.request.url)
        origin = f"{parsed.scheme}://{parsed.netloc}"
        if parsed.scheme in {"data", "blob"} or origin == allowed_origin:
            route.continue_()
        else:
            route.abort("blockedbyclient")

    context.route("**/*", route_request)
    context.route_web_socket(
        lambda url: urlparse(url).netloc != base.netloc,
        lambda websocket: websocket.close(),
    )


def attach_error_capture(page: Page, report: dict[str, Any]) -> None:
    console_errors: list[str] = report.setdefault("consoleErrors", [])
    page_errors: list[str] = report.setdefault("pageErrors", [])

    def console(message: Any) -> None:
        if message.type != "error":
            return
        text = message.text
        lower = text.lower()
        if "coinbase" in lower or "ws-feed.exchange" in lower:
            return
        console_errors.append(text)

    page.on("console", console)
    page.on("pageerror", lambda error: page_errors.append(str(error)))


def add_performance_observers(page: Page) -> None:
    page.add_init_script(
        """
        (() => {
          window.__atlasQuality = { cls: 0, longTaskDuration: 0 };
          try {
            new PerformanceObserver((list) => {
              for (const entry of list.getEntries()) {
                if (!entry.hadRecentInput) window.__atlasQuality.cls += entry.value;
              }
            }).observe({ type: 'layout-shift', buffered: true });
          } catch {}
          try {
            new PerformanceObserver((list) => {
              for (const entry of list.getEntries()) window.__atlasQuality.longTaskDuration += entry.duration;
            }).observe({ type: 'longtask', buffered: true });
          } catch {}
        })();
        """
    )


def wait_for_app(page: Page) -> None:
    page.get_by_text("ATLAS X", exact=True).first.wait_for(state="visible", timeout=20_000)
    page.get_by_role("button", name="复核买入").wait_for(state="visible", timeout=20_000)


def wait_until_enabled(page: Page, selector: Any, timeout_ms: int = 10_000) -> None:
    deadline = time.monotonic() + timeout_ms / 1000
    while time.monotonic() < deadline:
        if selector.is_enabled():
            return
        page.wait_for_timeout(100)
    raise AssertionError("Timed out waiting for control to become enabled")


def run_paper_flow(page: Page, gate: QualityGate, report: dict[str, Any]) -> None:
    review = page.get_by_role("button", name="复核买入")
    wait_until_enabled(page, review)
    review.click()
    dialog = page.get_by_role("dialog", name="确认模拟委托")
    dialog.wait_for(state="visible", timeout=5_000)
    gate.check("买入 0.1 BTC" in dialog.inner_text(), "Order review did not show the deterministic 0.1 BTC buy")
    dialog.get_by_role("button", name="确认提交").click()
    page.get_by_text("模拟成交已记入账本", exact=True).wait_for(state="visible", timeout=10_000)

    page.get_by_role("button", name="资产", exact=True).click()
    page.get_by_role("heading", name="资产与持仓").wait_for(state="visible", timeout=5_000)
    main = page.locator("main")
    main.get_by_text("BTC-USD", exact=True).wait_for(state="visible", timeout=10_000)
    gate.check("0.1" in main.inner_text(), "Assets page did not expose the filled 0.1 BTC position")
    before_reload = main.inner_text()

    page.reload(wait_until="domcontentloaded", timeout=20_000)
    wait_for_app(page)
    page.get_by_role("button", name="资产", exact=True).click()
    page.get_by_role("heading", name="资产与持仓").wait_for(state="visible", timeout=5_000)
    restored_main = page.locator("main")
    restored_main.get_by_text("BTC-USD", exact=True).wait_for(state="visible", timeout=10_000)
    restored = restored_main.inner_text()
    gate.check("0.1" in restored, "IndexedDB reload did not restore the 0.1 BTC position")
    report["paperFlow"] = {
        "filled": True,
        "positionVisibleBeforeReload": "BTC-USD" in before_reload and "0.1" in before_reload,
        "positionVisibleAfterReload": "BTC-USD" in restored and "0.1" in restored,
    }


def ensure_service_worker_control(page: Page) -> bool:
    supported = page.evaluate("() => 'serviceWorker' in navigator")
    if not supported:
        return False
    page.evaluate("() => navigator.serviceWorker.ready.then(() => true)")
    controlled = page.evaluate("() => navigator.serviceWorker.controller !== null")
    if not controlled:
        page.reload(wait_until="domcontentloaded", timeout=20_000)
        wait_for_app(page)
        page.wait_for_function("() => navigator.serviceWorker.controller !== null", timeout=15_000)
    return bool(page.evaluate("() => navigator.serviceWorker.controller !== null"))


def run_offline_recovery(
    context: BrowserContext,
    page: Page,
    gate: QualityGate,
    report: dict[str, Any],
) -> None:
    page.get_by_role("button", name="交易", exact=True).click()
    controlled = ensure_service_worker_control(page)
    gate.check(controlled, "Service worker did not control the production preview")
    offline_shell = False
    context.set_offline(True)
    try:
        page.reload(wait_until="domcontentloaded", timeout=20_000)
        wait_for_app(page)
        page.get_by_text("离线模式", exact=True).wait_for(state="visible", timeout=10_000)
        offline_shell = True
    finally:
        context.set_offline(False)
    page.get_by_text("连接已恢复", exact=True).wait_for(state="visible", timeout=10_000)
    report["offlineRecovery"] = {
        "serviceWorkerControlled": controlled,
        "offlineShellRendered": offline_shell,
        "recoveryNoticeRendered": True,
    }


def accessibility_audit(
    context: BrowserContext,
    page: Page,
    gate: QualityGate,
    report: dict[str, Any],
) -> None:
    dom = page.evaluate(
        """
        () => {
          const visible = (element) => {
            const style = getComputedStyle(element);
            const rect = element.getBoundingClientRect();
            return style.visibility !== 'hidden' && style.display !== 'none' && rect.width > 0 && rect.height > 0;
          };
          const accessibleName = (element) => {
            const labelledBy = element.getAttribute('aria-labelledby');
            if (labelledBy) return labelledBy.split(/\\s+/).map((id) => document.getElementById(id)?.textContent ?? '').join(' ').trim();
            const label = element.getAttribute('aria-label');
            if (label) return label.trim();
            if (element.id) {
              const explicit = document.querySelector(`label[for="${CSS.escape(element.id)}"]`);
              if (explicit) return explicit.textContent?.trim() ?? '';
            }
            const wrapped = element.closest('label');
            if (wrapped) return wrapped.textContent?.trim() ?? '';
            return element.textContent?.trim() ?? element.getAttribute('alt')?.trim() ?? '';
          };
          const unnamedControls = [...document.querySelectorAll('button,a[href],input,select,textarea')]
            .filter((element) => visible(element) && accessibleName(element) === '')
            .map((element) => element.outerHTML.slice(0, 180));
          const duplicateIds = [...document.querySelectorAll('[id]')]
            .map((element) => element.id)
            .filter((id, index, values) => id && values.indexOf(id) !== index);
          const unlabeledInputs = [...document.querySelectorAll('input,select,textarea')]
            .filter((element) => visible(element) && accessibleName(element) === '')
            .map((element) => element.outerHTML.slice(0, 180));
          const imagesWithoutAlt = [...document.querySelectorAll('img')]
            .filter((image) => visible(image) && !image.hasAttribute('alt') && image.getAttribute('role') !== 'presentation')
            .map((image) => image.outerHTML.slice(0, 180));
          return {
            unnamedControls,
            duplicateIds: [...new Set(duplicateIds)],
            unlabeledInputs,
            imagesWithoutAlt,
            hasMain: document.querySelector('main') !== null,
            navCount: document.querySelectorAll('nav').length,
          };
        }
        """
    )

    session = context.new_cdp_session(page)
    ax_tree = session.send("Accessibility.getFullAXTree")
    unnamed_ax: list[str] = []
    for node in ax_tree.get("nodes", []):
        if node.get("ignored"):
            continue
        role = node.get("role", {}).get("value", "")
        name = str(node.get("name", {}).get("value", "")).strip()
        if role in INTERACTIVE_AX_ROLES and not name:
            unnamed_ax.append(f"{role}:{node.get('nodeId', 'unknown')}")

    page.locator("body").click(position={"x": 2, "y": 2})
    focus_path: list[dict[str, Any]] = []
    visible_focus_count = 0
    for _ in range(18):
        page.keyboard.press("Tab")
        focused = page.evaluate(
            """
            () => {
              const element = document.activeElement;
              if (!(element instanceof HTMLElement)) return { tag: '', name: '', visibleFocus: false };
              const style = getComputedStyle(element);
              const visibleFocus = (style.outlineStyle !== 'none' && Number.parseFloat(style.outlineWidth || '0') > 0)
                || style.boxShadow !== 'none';
              return {
                tag: element.tagName.toLowerCase(),
                name: (element.getAttribute('aria-label') || element.textContent || element.getAttribute('name') || '').trim().slice(0, 80),
                visibleFocus,
              };
            }
            """
        )
        focus_path.append(focused)
        if focused["visibleFocus"]:
            visible_focus_count += 1

    focusable = [item for item in focus_path if item["tag"] and item["tag"] != "body"]
    unique_focus = {(item["tag"], item["name"]) for item in focusable}
    gate.check(not dom["unnamedControls"], f"Visible controls without names: {dom['unnamedControls']}")
    gate.check(not dom["unlabeledInputs"], f"Visible form controls without labels: {dom['unlabeledInputs']}")
    gate.check(not dom["duplicateIds"], f"Duplicate DOM ids: {dom['duplicateIds']}")
    gate.check(not dom["imagesWithoutAlt"], f"Visible images without alt text: {dom['imagesWithoutAlt']}")
    gate.check(dom["hasMain"], "Page does not expose a main landmark")
    gate.check(dom["navCount"] >= 1, "Page does not expose a navigation landmark")
    gate.check(not unnamed_ax, f"Accessibility tree contains unnamed interactive nodes: {unnamed_ax}")
    gate.check(len(unique_focus) >= 8, f"Keyboard traversal reached only {len(unique_focus)} unique controls")
    gate.check(visible_focus_count >= 1, "Keyboard traversal never exposed a visible focus indicator")

    report["accessibility"] = {
        **dom,
        "unnamedAccessibilityNodes": unnamed_ax,
        "keyboardUniqueControls": len(unique_focus),
        "visibleFocusStops": visible_focus_count,
        "focusPath": focus_path,
    }


def performance_metrics(page: Page, gate: QualityGate, report: dict[str, Any]) -> None:
    metrics = page.evaluate(
        """
        () => {
          const navigation = performance.getEntriesByType('navigation')[0];
          const paint = performance.getEntriesByName('first-contentful-paint')[0];
          const resources = performance.getEntriesByType('resource');
          const resourceTransferBytes = resources.reduce((sum, entry) => sum + (entry.transferSize || 0), 0);
          const javascriptEncodedBytes = resources
            .filter((entry) => entry.name.includes('.js'))
            .reduce((sum, entry) => sum + (entry.encodedBodySize || 0), 0);
          const cssEncodedBytes = resources
            .filter((entry) => entry.name.includes('.css'))
            .reduce((sum, entry) => sum + (entry.encodedBodySize || 0), 0);
          return {
            firstContentfulPaintMs: paint?.startTime ?? 0,
            loadEventMs: navigation?.loadEventEnd ?? 0,
            resourceTransferBytes,
            javascriptEncodedBytes,
            cssEncodedBytes,
            domNodes: document.querySelectorAll('*').length,
            cumulativeLayoutShift: window.__atlasQuality?.cls ?? 0,
            longTaskDurationMs: window.__atlasQuality?.longTaskDuration ?? 0,
          };
        }
        """
    )
    for name, budget in PERFORMANCE_BUDGETS.items():
        value = float(metrics.get(name, 0))
        gate.check(value <= budget, f"Performance budget exceeded: {name}={value} > {budget}")
    report["performance"] = {"metrics": metrics, "budgets": PERFORMANCE_BUDGETS}


def capture_viewports(
    browser: Browser,
    base_url: str,
    output: Path,
    gate: QualityGate,
    report: dict[str, Any],
) -> None:
    screenshots: list[dict[str, Any]] = []
    for name, viewport in VIEWPORTS.items():
        context = browser.new_context(viewport=viewport, service_workers="allow")
        install_network_boundaries(context, base_url)
        page = context.new_page()
        page.goto(base_url, wait_until="domcontentloaded", timeout=20_000)
        wait_for_app(page)
        page.wait_for_timeout(600)
        dimensions = page.evaluate(
            """
            () => ({
              scrollWidth: document.documentElement.scrollWidth,
              clientWidth: document.documentElement.clientWidth,
              scrollHeight: document.documentElement.scrollHeight,
              clientHeight: document.documentElement.clientHeight,
            })
            """
        )
        gate.check(
            dimensions["scrollWidth"] <= dimensions["clientWidth"] + 1,
            f"Horizontal overflow at {name}: {dimensions}",
        )
        screenshot = output / "screenshots" / f"{name}.png"
        page.screenshot(path=str(screenshot), full_page=False)
        screenshots.append({
            "name": name,
            "viewport": viewport,
            "path": str(screenshot.relative_to(output)),
            "dimensions": dimensions,
            "bytes": screenshot.stat().st_size,
        })
        context.close()
    report["screenshots"] = screenshots


def run(playwright: Playwright, args: argparse.Namespace) -> tuple[dict[str, Any], list[str]]:
    output = Path(args.output).resolve()
    (output / "screenshots").mkdir(parents=True, exist_ok=True)
    gate = QualityGate()
    report: dict[str, Any] = {
        "schemaVersion": "atlas.web-quality.v1",
        "head": os.environ.get("GITHUB_SHA", "local"),
        "baseUrl": args.base_url,
        "viewports": VIEWPORTS,
        "failures": gate.failures,
    }

    browser = playwright.chromium.launch(
        headless=True,
        executable_path=chrome_executable(),
        args=["--no-sandbox", "--disable-dev-shm-usage"],
    )
    report["browserVersion"] = browser.version
    try:
        context = browser.new_context(viewport=VIEWPORTS["desktop-1440x900"], service_workers="allow")
        install_network_boundaries(context, args.base_url)
        page = context.new_page()
        add_performance_observers(page)
        attach_error_capture(page, report)
        context.tracing.start(screenshots=True, snapshots=True, sources=False)
        try:
            page.goto(args.base_url, wait_until="domcontentloaded", timeout=20_000)
            wait_for_app(page)
            page.wait_for_load_state("load", timeout=20_000)
            page.wait_for_timeout(800)
            performance_metrics(page, gate, report)
            accessibility_audit(context, page, gate, report)
            run_paper_flow(page, gate, report)
            run_offline_recovery(context, page, gate, report)
        finally:
            try:
                context.tracing.stop(path=str(output / "primary-flow-trace.zip"))
            finally:
                context.close()

        capture_viewports(browser, args.base_url, output, gate, report)
    finally:
        browser.close()

    gate.check(not report.get("consoleErrors"), f"Unexpected console errors: {report.get('consoleErrors', [])}")
    gate.check(not report.get("pageErrors"), f"Unhandled page errors: {report.get('pageErrors', [])}")
    report["failures"] = gate.failures
    report["passed"] = not gate.failures
    return report, gate.failures


def main() -> int:
    args = parse_args()
    output = Path(args.output).resolve()
    output.mkdir(parents=True, exist_ok=True)
    try:
        with sync_playwright() as playwright:
            report, failures = run(playwright, args)
    except Exception as error:
        report = {
            "schemaVersion": "atlas.web-quality.v1",
            "head": os.environ.get("GITHUB_SHA", "local"),
            "baseUrl": args.base_url,
            "passed": False,
            "failures": [f"Quality runner crashed: {error}"],
            "traceback": traceback.format_exc(),
        }
        failures = report["failures"]
    report_path = output / "quality-report.json"
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    if failures:
        print("[web-quality] FAILED")
        for failure in failures:
            print(f"- {failure}")
        print(f"[web-quality] report={report_path}")
        return 1
    print(
        f"[web-quality] PASS browser={report['browserVersion']} "
        f"viewports={len(report['screenshots'])} "
        f"a11y-nameless={len(report['accessibility']['unnamedAccessibilityNodes'])} "
        f"report={report_path}"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
