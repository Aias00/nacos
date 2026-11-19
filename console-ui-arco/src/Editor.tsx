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
import * as monaco from 'monaco-editor';
import MonacoEditor, { loader, type Monaco } from '@monaco-editor/react';
import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
import jsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker';
import htmlWorker from 'monaco-editor/esm/vs/language/html/html.worker?worker';

self.MonacoEnvironment = {
  getWorker: (_, label) => label === 'json' ? new jsonWorker()
    : ['html', 'handlebars', 'razor'].includes(label) ? new htmlWorker() : new editorWorker(),
};
loader.config({ monaco: monaco as unknown as Monaco });
const languages: Record<string, string> = { text: 'plaintext', yaml: 'yaml', json: 'json',
  xml: 'xml', html: 'html', properties: 'ini', toml: 'ini' };

export default function Editor({ value, onChange, type, dark = false, readOnly = false, height = 380 }: {
  value: string; onChange?: (value: string) => void; type: string;
  dark?: boolean; readOnly?: boolean; height?: number | string;
}) {
  return <div className="editor-frame"><MonacoEditor height={height} value={value}
    language={languages[type] || 'plaintext'} theme={dark ? 'vs-dark' : 'vs'}
    onChange={(next) => onChange?.(next || '')} options={{ readOnly, minimap: { enabled: false },
      // Textarea input preserves keyboard/IME focus within Arco's accessible focus lock.
      editContext: false,
      scrollbar: { alwaysConsumeMouseWheel: false },
      fontSize: 13, scrollBeyondLastLine: false, automaticLayout: true, tabSize: 2,
      ariaLabel: readOnly ? '配置内容（只读）' : '配置内容编辑器' }} /></div>;
}
