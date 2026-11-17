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
"""Check the rendered page canvas stays dark across views and after reload."""
import argparse
import io
import json
from pathlib import Path
from PIL import Image
from playwright.sync_api import expect, sync_playwright


def run(base, output):
    output.mkdir(parents=True, exist_ok=True)
    results = []
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page(viewport={'width': 1440, 'height': 1000}, locale='zh-CN')
        page.goto(base + '?preview=demo#/overview', wait_until='networkidle')
        page.get_by_role('button', name='深色模式', exact=True).click()
        expect(page.locator('body')).to_have_attribute('arco-theme', 'dark')
        assert page.locator('html').evaluate('(el) => getComputedStyle(el).colorScheme') == 'dark'
        for route in ['overview', 'configs', 'history', 'listeners', 'services', 'subscribers', 'namespaces', 'cluster', 'access']:
            page.goto(base + '?preview=demo#/' + route, wait_until='networkidle')
            expect(page.locator('body')).to_have_attribute('arco-theme', 'dark')
            box = page.locator('.console-content').bounding_box()
            shot = page.screenshot(full_page=True, animations='disabled')
            image = Image.open(io.BytesIO(shot)).convert('RGB')
            points = [(int(box['x'] + box['width'] - 4), int(box['y'] + 4)), (1436, 996)]
            colors = [image.getpixel(point) for point in points]
            assert all(max(color) < 100 for color in colors), (route, colors)
            (output / (route + '-dark.png')).write_bytes(shot)
            results.append(dict(route=route, canvas_pixels=colors))
        page.get_by_role('button', name='浅色模式', exact=True).click()
        expect(page.locator('body')).to_have_attribute('arco-theme', 'light')
        assert page.locator('html').evaluate('(el) => getComputedStyle(el).colorScheme') == 'light'
        box = page.locator('.console-content').bounding_box()
        image = Image.open(io.BytesIO(page.screenshot())).convert('RGB')
        color = image.getpixel((int(box['x'] + box['width'] - 4), int(box['y'] + 4)))
        assert min(color) > 200, color
        page.reload(wait_until='networkidle')
        expect(page.locator('body')).to_have_attribute('arco-theme', 'light')
        assert page.locator('html').evaluate('(el) => getComputedStyle(el).colorScheme') == 'light'
        (output / 'result.json').write_text(json.dumps(dict(passed=True, dark_views=results, light_restored=True), indent=2))
        browser.close()


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--base-url', default='http://127.0.0.1:15175/')
    parser.add_argument('--output', type=Path, default=Path('/tmp/dark-background-e2e'))
    args = parser.parse_args()
    run(args.base_url, args.output)
