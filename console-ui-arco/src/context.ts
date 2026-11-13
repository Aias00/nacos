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
import { createContext, useContext } from 'react';
import type { Namespace, Session } from './types';

export interface ConsoleContext {
  session: Session; namespaces: Namespace[]; namespace: string; setNamespace: (id: string) => void;
  reloadNamespaces: () => Promise<void>; dark: boolean;
  namespaceLocked: boolean; setNamespaceLocked: (locked: boolean) => void;
}
export const Context = createContext<ConsoleContext | null>(null);
export function useConsole() {
  const context = useContext(Context);
  if (!context) throw new Error('Console context unavailable');
  return context;
}
