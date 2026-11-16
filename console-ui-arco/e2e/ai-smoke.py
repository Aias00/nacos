# Copyright 1999-2026 Alibaba Group Holding Ltd.
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
# http://www.apache.org/licenses/LICENSE-2.0
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.
"""Browser QA for AI pages. Explicit demo and intercepted live APIs only; no credentials required."""
import argparse
import json
import re
import zipfile
from pathlib import Path

from playwright.sync_api import expect, sync_playwright


KINDS = [
    ("mcp", "demo-mcp", True),
    ("agents", "demo-agent", True),
    ("prompts", "demo-assistant", False),
    ("skills", "demo-skill", False),
    ("agentspecs", "demo-agent-spec", False),
]


def run(base_url, output):
    output.mkdir(parents=True, exist_ok=True)
    checks, errors, requests = [], [], []
    report = {"passed": False, "checks": checks}
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        context = browser.new_context(locale="zh-CN", viewport={"width": 1440, "height": 1100}, accept_downloads=True, permissions=["clipboard-read", "clipboard-write"])
        page = context.new_page()
        page.set_default_timeout(12000)
        page.on("pageerror", lambda error: errors.append(str(error)))
        page.on("request", lambda req: requests.append(req.url) if req.resource_type in ["fetch", "xhr"] or re.search(r"/(?:platform-api|v3|nacos)/", req.url) else None)

        def screenshot(name):
            page.screenshot(path=str(output / f"{name}.png"), full_page=True, animations="disabled")

        def route(name):
            page.evaluate("name => location.hash = '/' + name", name)

        def field(container, label, value):
            item = container.locator(".arco-form-item").filter(has=page.locator(".arco-form-label-item").get_by_text(label, exact=True))
            item.locator("input, textarea").first.fill(value)

        def monaco(container, value, index=0):
            editor = container.get_by_role("textbox", name="配置内容编辑器", exact=True).nth(index)
            expect(editor).to_be_attached()
            editor.focus()
            page.keyboard.press("ControlOrMeta+A")
            page.evaluate("text => navigator.clipboard.writeText(text)", value)
            page.keyboard.press("ControlOrMeta+V")

        def locked():
            expect(page.locator(".namespace-picker .arco-select")).to_have_class(re.compile(r"arco-select-disabled"))

        def confirm(label):
            modal = page.locator(".arco-modal").last
            expect(modal).to_be_visible()
            modal.get_by_role("button", name=label, exact=True).click()
            expect(modal).not_to_be_visible()

        def close_detail(registry):
            if registry:
                page.locator(".arco-drawer-close-icon").last.click()
            else:
                page.locator(".arco-drawer").last.get_by_role("button", name="关闭", exact=True).click()
            expect(page.locator(".arco-drawer")).to_have_count(0)

        try:
            page.goto(base_url.rstrip("/") + "/?preview=demo#/mcp")
            page.wait_for_load_state("networkidle")
            (output / "initial.html").write_text(page.content())
            screenshot("initial-mcp")
            expect(page.get_by_role("button", name="demo-mcp", exact=True)).to_be_visible()
            ai_menu = page.locator(".arco-menu-inline-header").filter(has_text="AI 资源管理")
            for name in ["MCP 服务", "Agent 管理", "Skill 管理", "Prompt 管理", "AgentSpec 管理"]:
                expect(page.get_by_role("menuitem", name=name, exact=True)).to_be_visible()
            ai_menu.click()
            expect(page.get_by_role("menuitem", name="MCP 服务", exact=True)).not_to_be_visible()
            ai_menu.click()
            expect(page.get_by_role("menuitem", name="MCP 服务", exact=True)).to_be_visible()
            checks.append("all five AI menu entries initially visible; active submenu collapses and expands")

            for kind, name, registry in KINDS:
                route(kind)
                page.get_by_role("button", name=name, exact=True).click()
                detail = page.locator(".arco-drawer").last
                expect(detail.get_by_role("button", name="编辑草稿", exact=True)).to_be_enabled()
                detail.get_by_role("button", name="编辑草稿", exact=True).click()
                editor = page.locator(".arco-modal").last if registry else page.locator(".arco-drawer").last
                locked()
                # Identity fields stay immutable throughout an edit operation.
                expect(editor.get_by_placeholder("唯一资源名称") if registry else editor.get_by_placeholder("稳定资源名称" if kind != "skills" else "小写字母、数字和连字符，与 SKILL.md name 一致")).to_be_disabled()
                if kind == "mcp":
                    field(editor, "描述", "AI browser QA edited MCP")
                elif kind == "agents":
                    field(editor, "版本变更说明", "AI browser QA edited Agent")
                elif kind == "prompts":
                    monaco(editor, "Browser QA: {{question}}")
                elif kind == "skills":
                    monaco(editor, "---\nname: demo-skill\ndescription: Browser QA skill\n---\n\n# Browser QA Skill\n")
                else:
                    monaco(editor, json.dumps({"name": "demo-agent-spec", "description": "Browser QA AgentSpec", "version": "1.1.0"}))
                editor.get_by_role("button", name="保存草稿", exact=True).click()
                if registry:
                    expect(editor).not_to_be_visible()
                else:
                    expect(page.get_by_text(f"编辑 {name} 草稿", exact=True)).not_to_be_visible()
                detail = page.locator(".arco-drawer").last
                expect(detail.get_by_role("button", name="编辑草稿", exact=True)).to_be_enabled()
                screenshot(f"{kind}-edited")
                if kind in ["prompts", "skills"]:
                    with page.expect_download() as pending:
                        detail.get_by_role("button", name="下载此版本" + (" ZIP" if kind == "skills" else ""), exact=True).click()
                    download = pending.value
                    target = output / download.suggested_filename
                    download.save_as(target)
                    if kind == "skills":
                        with zipfile.ZipFile(target) as archive:
                            assert archive.testzip() is None
                            assert "Browser QA Skill" in archive.read("SKILL.md").decode()
                    else:
                        assert "Browser QA:" in target.read_text()
                    checks.append(f"{kind} downloads preserve edited content")
                detail.get_by_role("button", name="提交审核", exact=True).click()
                confirm("确认" if registry else "提交审核")
                expect(detail.get_by_role("button", name="1.1.0 · 当前", exact=True) if registry else detail.get_by_role("tab", name="版本 1.1.0 内容", exact=True)).to_be_visible()
                publish = "发布" if registry else "发布审核通过版本"
                expect(detail.get_by_role("button", name=publish, exact=True)).to_be_enabled()
                expect(detail.get_by_role("button", name="编辑草稿", exact=True)).to_have_count(0)
                detail.get_by_role("button", name=publish, exact=True).click()
                confirm("确认" if registry else "发布")
                expect(detail.get_by_role("button", name="1.1.0 · 当前", exact=True) if registry else detail.get_by_role("tab", name="版本 1.1.0 内容", exact=True)).to_be_visible()
                offline = "下线" if registry else "下线版本"
                expect(detail.get_by_role("button", name=offline, exact=True)).to_be_enabled()
                screenshot(f"{kind}-published")
                detail.get_by_role("button", name=offline, exact=True).click()
                confirm("确认" if registry else "下线")
                expect(detail.get_by_role("button", name="1.1.0 · 当前", exact=True) if registry else detail.get_by_role("tab", name="版本 1.1.0 内容", exact=True)).to_be_visible()
                online = "上线" if registry else "上线版本"
                expect(detail.get_by_role("button", name=online, exact=True)).to_be_enabled()
                detail.get_by_role("button", name=online, exact=True).click()
                confirm("确认" if registry else "上线")
                expect(detail.get_by_role("button", name=offline, exact=True)).to_be_enabled()
                checks.append(f"{kind} edit, immutable identity, review, publish, offline/online")
                close_detail(registry)

            # Create new resources through forms (including AgentSpec's create-then-update path).
            for kind, _, registry in KINDS:
                route(kind)
                name = "browser-qa-" + kind
                page.get_by_role("button", name="新建 MCP" if kind == "mcp" else "新建 Agent" if registry else "新建草稿", exact=True).click()
                editor = page.locator(".arco-modal").last if registry else page.locator(".arco-drawer").last
                locked()
                field(editor, "资源名称", name)
                if registry:
                    field(editor, "精确版本", "1.0.0")
                    if kind == "mcp":
                        field(editor, "Endpoint URL", "https://example.invalid/mcp")
                    else:
                        field(editor, "显示名称", name)
                        field(editor, "描述", "Browser-created Agent")
                else:
                    field(editor, "目标版本（可选，由服务端校验并生成）", "1.0.0")
                    field(editor, "描述（SKILL.md 中的 description 优先）" if kind == "skills" else "描述", "Browser-created document")
                    content = "A browser-created prompt" if kind == "prompts" else f"---\nname: {name}\ndescription: Browser-created skill\n---\n\n# Browser Skill" if kind == "skills" else json.dumps({"name": name, "version": "1.0.0", "description": "Browser AgentSpec"})
                    monaco(editor, content)
                editor.get_by_role("button", name="保存草稿", exact=True).click()
                if registry:
                    expect(editor).not_to_be_visible()
                else:
                    expect(page.get_by_text("新建 " + {"prompts": "Prompt", "skills": "Skill", "agentspecs": "AgentSpec"}[kind] + " 草稿", exact=True)).not_to_be_visible()
                created_detail = page.locator(".arco-drawer").last
                expect(created_detail.get_by_role("button", name="编辑草稿", exact=True)).to_be_enabled()
                expect(created_detail.get_by_text("没有可用的发布版本", exact=True)).to_have_count(0)
                if kind == "mcp":
                    created_detail.get_by_role("button", name="编辑草稿", exact=True).click()
                    modal = page.locator(".arco-modal").last
                    field(modal, "描述", "Fresh MCP remains manageable before first publish")
                    field(modal, "Endpoint URL", "https://example.invalid/mcp")
                    modal.get_by_role("button", name="保存草稿", exact=True).click()
                    expect(modal).not_to_be_visible()
                    created_detail = page.locator(".arco-drawer").last
                    created_detail.get_by_role("button", name="提交审核", exact=True).click()
                    confirm("确认")
                    expect(created_detail.get_by_role("button", name="1.0.0 · 当前", exact=True)).to_be_visible()
                    expect(created_detail.get_by_role("button", name="发布", exact=True)).to_be_enabled()
                    checks.append("first-draft-only MCP remains editable/submittable without any serving version")
                close_detail(registry)
                expect(page.get_by_role("button", name=name, exact=True)).to_be_visible()
                checks.append(f"{kind} resource creation form")

            route("prompts")
            page.locator(".namespace-picker .arco-select-view").click()
            page.locator(".arco-select-option").filter(has_text="测试环境 (test)").click()
            expect(page.get_by_role("button", name="browser-qa-prompts", exact=True)).to_have_count(0)
            expect(page.get_by_role("button", name="demo-assistant", exact=True)).to_have_count(0)
            page.locator(".namespace-picker .arco-select-view").click()
            page.locator(".arco-select-option").filter(has_text="开发环境 (dev)").click()
            expect(page.get_by_role("button", name="browser-qa-prompts", exact=True)).to_be_visible()
            checks.append("AI resources remain isolated between namespace IDs")

            route("copilot")
            expect(page.get_by_text("未配置凭据", exact=True)).to_be_visible()
            page.get_by_role("button", name="编辑配置", exact=True).click()
            drawer = page.locator(".arco-drawer").last
            locked()
            key = drawer.get_by_placeholder("输入 DashScope API Key", exact=True)
            expect(key).to_have_attribute("type", "password")
            key.fill("browser-demo-key-only")
            drawer.get_by_role("button", name="保存配置", exact=True).click()
            expect(drawer).not_to_be_visible()
            expect(page.get_by_text("已配置凭据", exact=True)).to_be_visible()
            assert "browser-demo-key-only" not in page.locator("body").inner_text()
            assert "browser-demo-key-only" not in page.evaluate("JSON.stringify({...localStorage})")
            assert "browser-demo-key-only" not in page.evaluate("JSON.stringify({...sessionStorage})")
            page.get_by_role("button", name="编辑配置", exact=True).click()
            key = page.get_by_placeholder("输入 DashScope API Key", exact=True)
            key.fill("")
            page.get_by_role("button", name="保存配置", exact=True).click()
            expect(page.locator(".arco-modal")).to_contain_text("确认清空现有 API Key")
            confirm("清空并保存")
            expect(page.get_by_text("未配置凭据", exact=True)).to_be_visible()
            checks.append("Copilot masks credentials, clears with confirmation, stores no key and invokes no model")
            screenshot("copilot")
            assert not requests, requests
            assert not errors, errors
            checks.append("demo makes zero API/network inference requests and has no browser runtime errors")

            # Separate mocked-live sessions never send a request to an actual Nacos server.
            for mode in ["disabled", "function-mode", "reader", "denied", "readonly"]:
                live = browser.new_context(locale="zh-CN", viewport={"width": 1440, "height": 1100})
                live.add_init_script("localStorage.setItem('nacos.arco.session.v1', JSON.stringify({mode:'live',accessToken:'browser-test-only',username:'reader',globalAdmin:" + ("false" if mode == "reader" else "true") + "}));")
                live_page = live.new_page()
                live_page.on("pageerror", lambda error: errors.append(str(error)))
                calls = []

                def mock_api(intercept):
                    path = intercept.request.url.split("?")[0]
                    calls.append(path)
                    if path.endswith("/server/state"):
                        intercept.fulfill(json={"version": "3.3.0", "ai_enabled": "false" if mode == "disabled" else "true", "copilot_enabled": "false" if mode == "disabled" else "true", "function_mode": "naming" if mode == "function-mode" else ""})
                    elif path.endswith("/namespace/list"):
                        intercept.fulfill(json={"code": 0, "data": [{"namespace": "dev", "namespaceShowName": "开发环境", "configCount": 0, "quota": 200, "type": 2}]})
                    elif mode == "denied":
                        intercept.fulfill(status=403, json={"code": 403, "message": "AI permission denied"})
                    elif path.endswith("/skills/list"):
                        intercept.fulfill(json={"code": 0, "data": {"totalCount": 1, "pageItems": [{"name": "readonly-skill", "description": "Read only", "writable": False, "labels": {"latest": "1.0.0"}}]}})
                    elif path.endswith("/skills/version"):
                        intercept.fulfill(json={"code": 0, "data": {"name": "readonly-skill", "skillMd": "# Read only", "resource": {}}})
                    elif path.endswith("/skills"):
                        intercept.fulfill(json={"code": 0, "data": {"writable": False, "labels": {"latest": "1.0.0"}, "versions": [{"version": "1.0.0", "status": "online"}]}})
                    else:
                        intercept.fulfill(json={"code": 0, "data": {"totalCount": 0, "pageItems": []}})

                live_page.route("**/platform-api/**", mock_api)
                target = "copilot" if mode == "reader" else "skills" if mode == "readonly" else "mcp"
                live_page.goto(base_url.rstrip("/") + "/#/" + target)
                live_page.wait_for_load_state("networkidle")
                if mode in ["disabled", "function-mode"]:
                    expect(live_page.get_by_text("此功能尚未启用", exact=True)).to_be_visible()
                    expect(live_page.get_by_role("menuitem", name="MCP 服务", exact=True)).to_have_count(0)
                    assert not any("/ai/" in path for path in calls)
                elif mode == "reader":
                    expect(live_page.get_by_text("暂无访问权限", exact=True)).to_be_visible()
                    expect(live_page.get_by_role("menuitem", name="Copilot 设置", exact=True)).to_have_count(0)
                    assert not any("/copilot/" in path for path in calls)
                elif mode == "denied":
                    expect(live_page.get_by_text("AI permission denied", exact=True)).to_be_visible()
                    assert live_page.evaluate("localStorage.getItem('nacos.arco.session.v1')")
                else:
                    live_page.get_by_role("button", name="readonly-skill", exact=True).click()
                    drawer = live_page.locator(".arco-drawer").last
                    expect(drawer.get_by_role("button", name="派生新草稿", exact=True)).to_be_disabled()
                    expect(drawer.get_by_role("button", name="下线版本", exact=True)).to_be_disabled()
                    expect(drawer.get_by_role("button", name="自定义版本标签", exact=True)).to_be_disabled()
                    assert not any(live_page.get_by_role("button", name="管理员强制发布", exact=True).all())
                live_page.screenshot(path=str(output / f"live-{mode}.png"), full_page=True, animations="disabled")
                checks.append(f"mock live {mode} gate")
                live.close()
            assert not errors, errors
            report["passed"] = True
        except Exception as error:
            report["error"] = str(error)
            report["browser_errors"] = errors
            screenshot("failure")
            (output / "failure.html").write_text(page.content())
            raise
        finally:
            (output / "result.json").write_text(json.dumps(report, ensure_ascii=False, indent=2))
            browser.close()
    print(json.dumps(report, ensure_ascii=False))


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--base-url", default="http://127.0.0.1:5174")
    parser.add_argument("--output-dir", type=Path, default=Path("/tmp/nacos-ai-e2e"))
    args = parser.parse_args()
    run(args.base_url, args.output_dir)
