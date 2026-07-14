import { useEffect, useRef, useState } from 'react';

interface ProbeSummary {
  hostCount: number;
  cnameCount: number;
  infrastructureCount: number;
  reverseProxyGroups: number;
}

interface CompleteMessage {
  type: 'complete';
  domain: string;
  yaml: string;
  summary: ProbeSummary;
}

type WorkerMessage =
  | CompleteMessage
  | { type: 'progress'; message: string }
  | { type: 'error'; message: string };

export function DomainProbe() {
  const workerRef = useRef<Worker | null>(null);
  const [domain, setDomain] = useState('');
  const [status, setStatus] = useState('');
  const [result, setResult] = useState<CompleteMessage | null>(null);
  const [running, setRunning] = useState(false);

  useEffect(() => () => workerRef.current?.terminate(), []);

  function analyze() {
    workerRef.current?.terminate();
    const worker = new Worker(new URL('./domainProbe.worker.ts', import.meta.url), { type: 'module' });
    workerRef.current = worker;
    setRunning(true);
    setResult(null);
    setStatus('Starting independent DNS analyzer');

    worker.onmessage = (event: MessageEvent<WorkerMessage>) => {
      const message = event.data;
      if (message.type === 'progress') {
        setStatus(message.message);
        return;
      }
      setRunning(false);
      if (message.type === 'error') {
        setStatus(message.message);
      } else {
        setResult(message);
        setStatus('Analysis complete');
      }
      worker.terminate();
      workerRef.current = null;
    };

    worker.onerror = () => {
      setRunning(false);
      setStatus('The experimental analyzer stopped unexpectedly.');
      worker.terminate();
      workerRef.current = null;
    };

    worker.postMessage({ domain });
  }

  function downloadConfig() {
    if (!result) return;
    const blob = new Blob([result.yaml], { type: 'text/yaml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'config.yml';
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <section className="domain-probe">
      <div className="domain-probe-heading">
        <div>
          <span className="panel-label">Experimental</span>
          <h3>DNS config generator</h3>
        </div>
        <span className="experimental-tag">removable</span>
      </div>
      <div className="domain-probe-controls">
        <input
          type="text"
          value={domain}
          placeholder="example.com"
          aria-label="Root domain"
          onChange={(event) => setDomain(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !running && domain.trim()) analyze();
          }}
        />
        <button type="button" onClick={analyze} disabled={running || domain.trim().length === 0}>
          {running ? 'Analyzing' : 'Analyze'}
        </button>
      </div>
      {status && <div className="domain-probe-status">{status}</div>}
      {result && (
        <>
          <div className="domain-probe-summary">
            <span>{result.summary.hostCount} hosts</span>
            <span>{result.summary.cnameCount} CNAMEs</span>
            <span>{result.summary.infrastructureCount} inferred machines</span>
            <span>{result.summary.reverseProxyGroups} shared routes</span>
          </div>
          <button type="button" className="domain-probe-download" onClick={downloadConfig}>
            Download config.yml
          </button>
        </>
      )}
    </section>
  );
}
