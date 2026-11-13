/*
 * Copyright 1999-2026 Alibaba Group Holding Ltd.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

const { brand } = vi.hoisted(() => ({ brand: { name: '', logo: '', showVersion: true } }));
vi.mock('@/lib/branding', () => ({ consoleBranding: brand }));
import { ConsoleLogo } from '../console-logo';

describe('primary console logo', () => {
  beforeEach(() => { brand.name = ''; brand.logo = ''; });

  it('retains the original logo by default', () => {
    expect(renderToStaticMarkup(<ConsoleLogo src="original.svg" alt="Nacos" />))
      .toContain('src="original.svg"');
  });

  it('renders a custom name as escaped text without loading the original wordmark', () => {
    brand.name = '<img src=x onerror=alert(1)>';
    const html = renderToStaticMarkup(<ConsoleLogo src="original.svg" alt="Nacos" />);
    expect(html).toContain('&lt;img');
    expect(html).not.toContain('<img');
    expect(html).not.toContain('original.svg');
  });

  it('uses the configured asset and product label', () => {
    brand.name = 'Internal Console';
    brand.logo = '/branding/logo.svg';
    const html = renderToStaticMarkup(<ConsoleLogo src="original.svg" alt="Nacos" />);
    expect(html).toContain('src="/branding/logo.svg"');
    expect(html).toContain('alt="Internal Console"');
    expect(html).not.toContain('original.svg');
  });
});
