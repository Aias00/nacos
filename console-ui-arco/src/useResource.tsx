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
import { useCallback, useEffect, useState } from 'react';

export function useResource<T>(loader: (signal: AbortSignal) => Promise<T>) {
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<{
    loader: typeof loader; revision: number; data?: T; error?: Error;
  }>();
  useEffect(() => {
    const controller = new AbortController();
    loader(controller.signal).then((data) => {
      if (!controller.signal.aborted) setResult({ loader, revision, data });
    }).catch((error: unknown) => {
      if (!controller.signal.aborted) setResult({ loader, revision,
        error: error instanceof Error ? error : new Error('请求失败') });
    });
    return () => controller.abort();
  }, [loader, revision]);
  const reload = useCallback(() => setRevision((value) => value + 1), []);
  const loading = result?.loader !== loader || result?.revision !== revision;
  return { data: result?.data, error: loading ? undefined : result?.error, loading, reload };
}
