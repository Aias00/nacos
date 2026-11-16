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
"""Run against a started UI. Requires Python Playwright + Chromium, no live credentials."""
import argparse
import json
from pathlib import Path

from playwright.sync_api import expect, sync_playwright


def run(base_url, output):
    output.mkdir(parents=True, exist_ok=True)
    checks = []
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        context = browser.new_context(locale="zh-CN", viewport={"width": 1440, "height": 1000})
        page = context.new_page()
        page.set_default_timeout(10000)
        errors = []
        api_requests = []
        page.on("pageerror", lambda error: errors.append(str(error)))
        page.on("request", lambda request: api_requests.append(request.url) if "/platform-api/" in request.url else None)
        page.goto(base_url)
        page.wait_for_load_state("networkidle")
        page.screenshot(path=str(output / "login.png"), animations="disabled")

        def menu(name):
            page.get_by_role("menuitem", name=name, exact=True).click()

        def screenshot(name):
            expect(page.locator(".arco-spin-loading")).to_have_count(0)
            page.screenshot(path=str(output / name), full_page=True, animations="disabled")

        def namespace(label):
            page.locator(".namespace-picker .arco-select-view").click()
            page.locator(".arco-select-option").filter(has_text=label).click()

        def editor_text(text):
            editor = page.get_by_role("textbox", name="配置内容编辑器", exact=True)
            expect(editor).to_be_attached()
            editor.focus()
            page.keyboard.press("ControlOrMeta+A")
            page.keyboard.insert_text(text)

        # An invalid real login must remain a failed login, without entering demo mode.
        login_url = "**/platform-api/v3/auth/user/login"
        page.route(login_url, lambda route: route.fulfill(status=403, json={"code": 403, "message": "invalid credentials"}))
        page.get_by_placeholder("请输入用户名", exact=True).fill("invalid-user")
        page.get_by_placeholder("请输入密码", exact=True).fill("invalid-password")
        page.get_by_role("button", name="登录", exact=True).click()
        expect(page.get_by_text("invalid credentials", exact=True)).to_be_visible()
        expect(page.get_by_role("button", name="体验演示", exact=True)).to_be_visible()
        page.unroute(login_url)
        checks.append("failed live login stays isolated")
        api_requests.clear()

        page.get_by_role("button", name="体验演示", exact=True).click()
        expect(page.get_by_text("gateway.yaml", exact=True)).to_be_visible()
        screenshot("overview.png")
        menu("配置列表")
        expect(page.get_by_role("button", name="gateway.yaml", exact=True)).to_be_visible()
        group = page.locator(".arco-menu-inline-header").filter(has_text="配置管理")
        group.click()
        expect(page.get_by_role("menuitem", name="配置列表", exact=True)).not_to_be_visible()
        group.click()
        checks.append("active menu can collapse")
        screenshot("configs.png")

        page.get_by_role("button", name="新建配置", exact=True).click()
        drawer = page.locator(".arco-drawer")
        drawer.get_by_label("Data ID", exact=True).fill("arco-e2e.yaml")
        drawer.get_by_label("归属应用", exact=True).fill("e2e-app")
        drawer.get_by_label("描述", exact=True).fill("browser-created configuration")
        editor_text("enabled: true\n")
        screenshot("editor.png")
        drawer.get_by_role("button", name="发布配置", exact=True).click()
        expect(page.locator(".arco-modal")).to_contain_text("dev")
        page.get_by_role("button", name="确认发布", exact=True).click()
        expect(page.get_by_role("button", name="arco-e2e.yaml", exact=True)).to_be_visible()
        page.get_by_role("button", name="arco-e2e.yaml", exact=True).click()
        expect(drawer.get_by_label("归属应用", exact=True)).to_have_value("e2e-app")
        editor_text("enabled: false\n")
        drawer.get_by_role("button", name="发布配置", exact=True).click()
        page.get_by_role("button", name="确认发布", exact=True).click()
        expect(page.get_by_role("button", name="arco-e2e.yaml", exact=True)).to_be_visible()
        checks.append("configuration create and edit through Monaco")

        namespace("测试环境 (test)")
        expect(page.get_by_role("button", name="gateway.yaml", exact=True)).to_be_visible()
        expect(page.get_by_role("button", name="arco-e2e.yaml", exact=True)).not_to_be_visible()
        namespace("开发环境 (dev)")
        expect(page.get_by_role("button", name="arco-e2e.yaml", exact=True)).to_be_visible()
        checks.append("namespace ID isolation")
        row = page.get_by_role("row").filter(has_text="arco-e2e.yaml")
        row.get_by_role("button", name="历史", exact=True).click()
        expect(page.get_by_role("button", name="查看内容", exact=True)).to_have_count(2)
        page.get_by_role("button", name="查看内容", exact=True).first.click()
        expect(page.locator(".arco-modal .monaco-editor")).to_be_visible()
        page.get_by_role("button", name="关闭", exact=True).click()
        checks.append("history content")

        menu("监听查询")
        page.get_by_placeholder("请输入完整 Data ID", exact=True).fill("application.yaml")
        page.get_by_role("button", name="查询", exact=True).click()
        expect(page.get_by_role("cell", name="10.0.0.11", exact=True)).to_be_visible()
        checks.append("configuration listener query")

        menu("服务列表")
        page.get_by_role("row").filter(has_text="gateway").get_by_role("button", name="查看详情", exact=True).click()
        expect(page.get_by_role("switch", name="10.0.0.11 是否上线", exact=True)).to_be_checked()
        page.get_by_role("switch", name="10.0.0.11 是否上线", exact=True).click()
        page.get_by_role("button", name="下线", exact=True).click()
        expect(page.get_by_role("switch", name="10.0.0.11 是否上线", exact=True)).not_to_be_checked()
        page.get_by_role("tab", name="订阅者", exact=True).click()
        expect(page.get_by_role("cell", name="10.0.0.21", exact=True)).to_be_visible()
        screenshot("service.png")
        page.locator(".arco-drawer-close-icon").click()
        checks.append("service instances, state change and subscribers")

        menu("命名空间")
        page.get_by_role("button", name="新建命名空间", exact=True).click()
        modal = page.locator(".arco-modal")
        modal.get_by_label("Namespace ID", exact=True).fill("arco-e2e-space")
        modal.get_by_label("命名空间名称", exact=True).fill("E2E 空间")
        modal.get_by_role("button", name="确定", exact=True).click()
        row = page.get_by_role("row").filter(has_text="arco-e2e-space")
        expect(row).to_be_visible()
        row.get_by_role("button", name="删除", exact=True).click()
        page.locator(".arco-modal").get_by_role("button", name="删除", exact=True).click()
        expect(row).not_to_be_visible()
        checks.append("namespace create and empty delete")

        menu("集群管理")
        expect(page.get_by_text("127.0.0.1:8848", exact=True)).to_be_visible()
        menu("权限管理")
        page.get_by_role("tab", name="角色绑定", exact=True).click()
        expect(page.get_by_text("ROLE_ADMIN", exact=True)).to_be_visible()
        page.get_by_role("tab", name="角色权限", exact=True).click()
        expect(page.get_by_text("dev:*:config/*", exact=True)).to_be_visible()
        checks.append("cluster and read-only access views")

        menu("配置列表")
        page.get_by_role("row").filter(has_text="arco-e2e.yaml").get_by_role("button", name="删除", exact=True).click()
        page.locator(".arco-modal").get_by_role("button", name="删除", exact=True).click()
        expect(page.get_by_role("button", name="arco-e2e.yaml", exact=True)).not_to_be_visible()
        checks.append("configuration delete confirmation")
        page.get_by_role("button", name="深色模式", exact=True).click()
        expect(page.locator("body")).to_have_attribute("arco-theme", "dark")
        screenshot("dark.png")
        page.get_by_role("button", name="浅色模式", exact=True).click()
        page.set_viewport_size({"width": 390, "height": 844})
        expect(page.get_by_role("button", name="展开侧栏", exact=True)).to_be_visible()
        screenshot("mobile.png")
        assert page.evaluate("document.documentElement.scrollWidth <= window.innerWidth"), "page overflow on mobile"
        checks.append("theme and responsive layout")
        assert api_requests == [], api_requests
        assert errors == [], errors
        checks.append("demo never calls real APIs; no browser errors")
        context.close()

        # Mock live API errors to check permission handling and token expiration.
        live = browser.new_context(viewport={"width": 1440, "height": 1000})
        live.add_init_script("localStorage.setItem('nacos.arco.session.v1', JSON.stringify({mode:'live',accessToken:'test-only',username:'reader',globalAdmin:false}));")
        live_page = live.new_page()
        expired = False

        def mock_api(route):
            path = route.request.url.split("?")[0]
            if path.endswith("/server/state"):
                route.fulfill(json={"version": "3.3.0", "ai_enabled": False, "copilot_enabled": False})
            elif path.endswith("/namespace/list"):
                route.fulfill(json={"code": 0, "data": [{"namespace": "dev", "namespaceShowName": "开发环境", "configCount": 0, "quota": 200, "type": 2}]})
            else:
                route.fulfill(status=200 if expired else 403, json={"code": 403, "message": "token expired!" if expired else "authorization failed!"})

        live_page.route("**/platform-api/**", mock_api)
        live_page.goto(base_url.rstrip("/") + "/#/configs")
        expect(live_page.get_by_text("authorization failed!", exact=True)).to_be_visible()
        assert live_page.evaluate("localStorage.getItem('nacos.arco.session.v1')")
        expect(live_page.get_by_role("menuitem", name="权限管理", exact=True)).not_to_be_visible()
        expired = True
        live_page.get_by_role("button", name="刷新", exact=True).click()
        expect(live_page.get_by_role("button", name="登录", exact=True)).to_be_visible()
        assert live_page.evaluate("localStorage.getItem('nacos.arco.session.v1')") is None
        checks.append("permission denial keeps session; expired token logs out")
        live.close()
        browser.close()
    report = {"passed": True, "checks": checks}
    (output / "result.json").write_text(json.dumps(report, ensure_ascii=False, indent=2))
    print(json.dumps(report, ensure_ascii=False))


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--base-url", default="http://127.0.0.1:5174")
    parser.add_argument("--output-dir", type=Path, default=Path("/tmp/nacos-arco-e2e"))
    args = parser.parse_args()
    run(args.base_url, args.output_dir)
