import { useEffect, useRef, useState } from 'react';
import { api, ApiError, paginatedPath } from '../api/client.ts';
export default function IntegrationCheck() {
  const [status, setStatus] = useState('Ready. No requests have been sent.');
  const active = useRef<AbortController | null>(null);
  const cursor = useRef<string | null>(null);
  useEffect(() => () => active.current?.abort(), []);
  async function check(kind: 'health' | 'session' | 'projects' | 'next') {
    if (kind === 'next' && !cursor.current) { setStatus('No next page is available.'); return; }
    active.current?.abort(); const controller = new AbortController(); active.current = controller;
    setStatus('Loading…');
    try {
      let result: string;
      if (kind === 'health') { await api.health({ signal: controller.signal }); result = 'Health: HTTP 200.'; }
      else if (kind === 'session') { await api.currentUser({ signal: controller.signal }); result = 'Session: authenticated (HTTP 200). No profile or session values displayed.'; }
      else {
        const page = await api.get(paginatedPath('/api/v1/projects', { limit: 1, cursor: kind === 'next' ? cursor.current : null }), 'ProjectPage', { signal: controller.signal });
        if (active.current !== controller) return;
        cursor.current = page.nextCursor;
        result = `Projects: HTTP 200. ${page.items.length} item(s) on this page. Next page: ${page.nextCursor ? 'available' : 'none'}. No Project details displayed.`;
      }
      if (active.current === controller && !controller.signal.aborted) setStatus(result);
    } catch (error) {
      if (active.current !== controller) return;
      if (controller.signal.aborted) setStatus('Request cancelled.');
      else if (error instanceof ApiError) { cursor.current = null; setStatus(`${error.kind} (${error.status ?? 'no HTTP response'}): ${error.message}`); }
      else setStatus('Unexpected client error.');
    } finally { if (active.current === controller) active.current = null; }
  }
  return <main><h1>Travel Map — E3.1 integration check</h1><p>Local development only. GET requests only. No login/logout, mutations, demo data or credential display.</p>
    <div className="controls"><button onClick={() => void check('health')}>Check health</button><button onClick={() => void check('session')}>Check current session</button><button onClick={() => void check('projects')}>Check first Project page</button><button onClick={() => void check('next')}>Check next Project page</button><button onClick={() => active.current?.abort()}>Cancel request</button></div>
    <p role="status" aria-live="polite">{status}</p><p>401 means no active session. Use the existing approved Google flow in another tab, then return here. Do not copy cookies or CSRF values.</p><p>The isolated static demo is at <code>/demo/</code>. It never reads private API data.</p></main>;
}
