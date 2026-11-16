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
import { describe, expect, it } from 'vitest';
import { aiFeatures } from '../ai-state';
import { pipelineState } from '../components/ai/pipeline';

describe('effective AI capabilities', () => {
  it('keeps unavailable or unrecognized features closed', () => {
    expect(aiFeatures()).toEqual({ ai: false, copilot: false });
    expect(aiFeatures({ ai_enabled: 'false', copilot_enabled: 'false' })).toEqual({ ai: false, copilot: false });
    expect(aiFeatures({ ai_enabled: 1, copilot_enabled: 'TRUE' })).toEqual({ ai: false, copilot: false });
  });
  it('respects function mode while allowing independent Copilot configuration', () => {
    expect(aiFeatures({ ai_enabled: 'true', function_mode: 'ai', copilot_enabled: true })).toEqual({ ai: true, copilot: true });
    expect(aiFeatures({ ai_enabled: true })).toEqual({ ai: true, copilot: false });
    for (const function_mode of ['config', 'naming']) {
      expect(aiFeatures({ ai_enabled: true, function_mode, copilot_enabled: 'true' })).toEqual({ ai: false, copilot: true });
    }
  });
});

describe('current review authority', () => {
  it('accepts current pipeline DTOs and serialized DTOs', () => {
    expect(pipelineState({ status: 'approved' })).toBe('APPROVED');
    expect(pipelineState('{"status":"REJECTED","historical":false}')).toBe('REJECTED');
  });
  it('never authorizes a current action from a historical or malformed review', () => {
    for (const value of [undefined, null, '', '{broken', [], { status: 1 }, { status: 'APPROVED', historical: true },
      '{"status":"REJECTED","historical":true}']) {
      expect(pipelineState(value)).toBeNull();
    }
  });
});
