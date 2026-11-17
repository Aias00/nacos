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
"""Check long configuration names stay inside their columns and remain actionable."""
import argparse
import json
from pathlib import Path
from urllib.parse import urlsplit
from playwright.sync_api import expect, sync_playwright


def run(base, output):
    output.mkdir(parents=True, exist_ok=True)
    names = ['nacos.ai.resource.search.index.backfill', 'nacos.ai.resource.search.readiness.agentspec.v1', '配置名称' * 40]
    rows = [dict(dataId=name, groupName='nacos_internal' if i < 2 else 'LONG_GROUP_' * 25,
                 type='yaml', appName='LONG_APPLICATION_' * 25, content='enabled: true', desc='')
            for i, name in enumerate(names)]
    with sync_playwright() as p:
        browser = p.chromium.launch()
        context = browser.new_context(locale='zh-CN', viewport={'width': 1440, 'height': 1000})
        context.add_init_script('localStorage.setItem("platform.console.session.v1", JSON.stringify({mode:"live",username:"layout-test",accessToken:"mock-only",globalAdmin:true}))')
        page = context.new_page()
        errors = []
        page.on('pageerror', lambda error: errors.append(str(error)))

        def mock(route):
            path = urlsplit(route.request.url).path
            if path.endswith('/namespace/list'):
                data = [dict(namespace='public', namespaceShowName='公共空间', configCount=len(rows), quota=200)]
            elif path.endswith('/config/list'):
                data = dict(pageItems=rows, totalCount=len(rows), pageNumber=1)
            elif path.endswith('/cs/config'):
                data = rows[0]
            else:
                raise AssertionError('Unexpected API: ' + path)
            route.fulfill(json=dict(code=0, message='success', data=data))

        page.route('**/platform-api/**', mock)
        page.goto(base + '#/configs')
        button = page.get_by_role('button', name=names[0], exact=True)
        expect(button).to_be_visible()
        measurements = []
        for width in [1440, 948, 768, 390]:
            page.set_viewport_size({'width': width, 'height': 1000})
            page.wait_for_timeout(100)
            for row in page.locator('.arco-table-body .arco-table-tr').all():
                expect(row).to_be_visible()
            result = page.locator('.config-data-id').evaluate_all("""buttons => buttons.map(button => {
                const cell = button.closest('td');
                const a = button.getBoundingClientRect(), b = cell.getBoundingClientRect();
                const style = getComputedStyle(button);
                return {left:a.left, right:a.right, cellLeft:b.left, cellRight:b.right,
                    overflow:style.overflowX, ellipsis:style.textOverflow,
                    width:button.clientWidth, contentWidth:button.scrollWidth, text:button.textContent};
            })""")
            assert len(result) == 3
            for cell in result:
                assert cell['left'] >= cell['cellLeft'] and cell['right'] <= cell['cellRight'] + 1, cell
                assert cell['overflow'] == 'hidden' and cell['ellipsis'] == 'ellipsis', cell
                assert cell['contentWidth'] > cell['width'], cell
            measurements.append(dict(viewport=width, cells=result))
            page.screenshot(path=str(output / ('width-' + str(width) + '.png')), full_page=True)
        page.set_viewport_size({'width': 948, 'height': 1000})
        button.focus()
        expect(page.locator('.arco-tooltip-content')).to_contain_text(names[0])
        page.keyboard.press('Enter')
        expect(page.locator('.arco-drawer').get_by_label('Data ID', exact=True)).to_have_value(names[0])
        assert not errors, errors
        (output / 'result.json').write_text(json.dumps(dict(passed=True, measurements=measurements,
            keyboard_tooltip=True, full_identity_opened=True, page_errors=errors), ensure_ascii=False, indent=2))
        browser.close()


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--base-url', default='http://127.0.0.1:15175/')
    parser.add_argument('--output', type=Path, default=Path('/tmp/config-overflow-e2e'))
    args = parser.parse_args()
    run(args.base_url, args.output)
