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
"""Long configuration content must remain reachable above the drawer footer."""
import argparse
import json
from pathlib import Path
from playwright.sync_api import sync_playwright, expect


def run(base, output):
    output.mkdir(parents=True, exist_ok=True)
    checks = []
    with sync_playwright() as p:
        browser = p.chromium.launch()
        for height in [900, 650, 480]:
            page = browser.new_page(viewport={'width': 1200, 'height': height})
            page.goto(base + '?preview=demo#/configs', wait_until='networkidle')
            page.get_by_role('button', name='gateway.yaml', exact=True).click()
            editor = page.get_by_role('textbox', name='配置内容编辑器', exact=True)
            expect(editor).to_be_attached()
            editor.focus()
            page.keyboard.press('ControlOrMeta+A')
            page.keyboard.insert_text('\n'.join('line_' + str(i) + ': value' for i in range(200)) + '\nlast_line: visible')
            page.keyboard.press('ControlOrMeta+End')
            frame = page.locator('.editor-frame')
            frame.hover()
            page.mouse.wheel(0, 2000)
            page.wait_for_timeout(400)
            box = frame.bounding_box()
            footer = page.locator('.arco-drawer-footer').bounding_box()
            assert box['y'] + box['height'] <= footer['y'] + 1, (height, box, footer)
            expect(page.locator('.view-line').filter(has_text='last_line: visible')).to_be_visible()
            line = page.locator('.view-line').filter(has_text='last_line: visible').bounding_box()
            assert line['y'] + line['height'] <= footer['y'], (height, line, footer)
            expect(page.get_by_role('button', name='发布配置', exact=True)).to_be_visible()
            page.screenshot(path=str(output / (str(height) + '.png')))
            checks.append(dict(viewport_height=height, editor_bottom=box['y'] + box['height'], footer_top=footer['y']))
            page.close()
        browser.close()
    (output / 'result.json').write_text(json.dumps(dict(passed=True, checks=checks), indent=2))


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--base-url', default='http://127.0.0.1:15175/')
    parser.add_argument('--output', type=Path, default=Path('/tmp/editor-bottom-e2e'))
    args = parser.parse_args()
    run(args.base_url, args.output)
