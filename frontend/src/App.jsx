import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Camera, CirclePause, CirclePlay, RotateCcw, Send, Square, UploadCloud } from 'lucide-react';
import { createWorker } from 'tesseract.js';
import { api } from './services/api.js';
import { extractFiscalKey, maskKey } from './utils/ocr.js';

const tabs = [
  { id: 'capturar', label: 'Capturar notas' },
  { id: 'enviar', label: 'Enviar notas' }
];

export default function App() {
  const [activeTab, setActiveTab] = useState('capturar');

  return (
    <div className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">MVP</p>
          <h1>Leitor e Enviador de Notas</h1>
        </div>
        <nav className="tabs" aria-label="Abas do dashboard">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              className={activeTab === tab.id ? 'active' : ''}
              onClick={() => setActiveTab(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </nav>
      </header>

      <main>
        {activeTab === 'capturar' ? <CaptureNotes /> : <SendNotes />}
      </main>
    </div>
  );
}

function CaptureNotes() {
  const [imageUrl, setImageUrl] = useState('');
  const [file, setFile] = useState(null);
  const [ocrText, setOcrText] = useState('');
  const [key, setKey] = useState('');
  const [tipo, setTipo] = useState('DESCONHECIDO');
  const [needsConfirmation, setNeedsConfirmation] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState('');

  function onFileChange(event) {
    const selected = event.target.files?.[0];
    if (!selected) return;
    setFile(selected);
    setImageUrl(URL.createObjectURL(selected));
    setOcrText('');
    setKey('');
    setStatus('');
    setNeedsConfirmation(false);
    setConfirmed(false);
  }

  async function readNote() {
    if (!file) {
      setStatus('Escolha ou tire uma foto primeiro.');
      return;
    }

    setLoading(true);
    setStatus('Lendo imagem...');
    const worker = await createWorker('por');

    try {
      const result = await worker.recognize(file);
      const text = result.data.text || '';
      const extracted = extractFiscalKey(text);
      setOcrText(text);
      setKey(extracted.key);
      setTipo(extracted.tipo);
      setNeedsConfirmation(extracted.needsConfirmation);
      setConfirmed(!extracted.needsConfirmation);

      if (shouldUseAiFallback(extracted)) {
        setKey('');
        setTipo('DESCONHECIDO');
        setNeedsConfirmation(false);
        setConfirmed(false);
        setStatus('OCR nao encontrou uma chave confiavel. Tentando corrigir com IA...');
        try {
          await analyzeImageWithAi(text);
          return;
        } catch (aiError) {
          setStatus(`OCR e IA nao encontraram uma chave confiavel: ${aiError.message}. Digite manualmente.`);
          return;
        }
      }

      setStatus('Chave encontrada com OCR. Confira antes de salvar.');
    } catch (error) {
      setStatus(`Falha no OCR: ${error.message}`);
    } finally {
      await worker.terminate();
      setLoading(false);
    }
  }

  async function correctWithAi() {
    if (!file) {
      setStatus('Escolha ou tire uma foto primeiro.');
      return;
    }

    setLoading(true);
    setStatus('Analisando imagem com IA...');

    try {
      await analyzeImageWithAi(ocrText);
    } catch (error) {
      setStatus(error.message);
    } finally {
      setLoading(false);
    }
  }

  async function analyzeImageWithAi(sourceOcrText) {
    const imageDataUrl = await compressImageForAi(file);
    const result = await api.analyzeWithGroq({
      imageDataUrl,
      ocrText: sourceOcrText
    });

    if (result.chave_nfe) setKey(result.chave_nfe);
    if (result.tipo) setTipo(result.tipo);
    setNeedsConfirmation(false);
    setConfirmed(true);

    const confidence = Math.round((result.confianca || 0) * 100);
    setStatus(result.chave_nfe
      ? `IA encontrou a chave com ${confidence}% de confianca. Confira antes de salvar.`
      : 'IA nao encontrou uma chave com seguranca. Digite manualmente.');
  }

  async function saveNote() {
    const clean = key.replace(/\D/g, '');
    if (!clean) {
      setStatus('A chave nao pode ficar vazia.');
      return;
    }

    if (needsConfirmation && !confirmed) {
      setStatus('Confirme o possivel CFe-SAT antes de salvar.');
      return;
    }

    setLoading(true);
    setStatus('Salvando nota...');

    try {
      await api.createNota({
        chave_nfe: clean,
        tipo,
        origem: 'celular',
        ocr_texto: ocrText
      });
      setStatus('Nota salva como pendente.');
      setKey('');
      setOcrText('');
      setNeedsConfirmation(false);
      setConfirmed(false);
    } catch (error) {
      setStatus(error.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="capture-layout">
      <div className="panel capture-panel">
        <div className="section-heading">
          <h2>Capturar notas</h2>
          <Camera aria-hidden="true" />
        </div>

        <label className="file-picker">
          <UploadCloud aria-hidden="true" />
          <span>{file ? file.name : 'Abrir camera ou escolher imagem'}</span>
          <input type="file" accept="image/*" capture="environment" onChange={onFileChange} />
        </label>

        {imageUrl && (
          <div className="preview-frame">
            <img src={imageUrl} alt="Preview da nota capturada" />
          </div>
        )}

        <div className="actions">
          <button className="primary" onClick={readNote} disabled={loading || !file}>
            <Camera aria-hidden="true" />
            Ler nota
          </button>
          <button onClick={correctWithAi} disabled={loading || !file}>
            Corrigir com IA
          </button>
        </div>
      </div>

      <div className="panel form-panel">
        <h2>Chave encontrada</h2>
        <label>
          Chave
          <input
            value={key}
            onChange={(event) => setKey(event.target.value.replace(/\D/g, ''))}
            placeholder="Digite ou confirme a chave"
            inputMode="numeric"
          />
        </label>

        <label>
          Tipo
          <select value={tipo} onChange={(event) => setTipo(event.target.value)}>
            <option value="NFCE">NF-e/NFC-e</option>
            <option value="CFE_SAT">CFe-SAT</option>
            <option value="DESCONHECIDO">Desconhecido</option>
          </select>
        </label>

        {needsConfirmation && (
          <label className="checkbox-line">
            <input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />
            Confirmo que este numero e um possivel CFe-SAT.
          </label>
        )}

        <button className="primary full" onClick={saveNote} disabled={loading}>
          Salvar nota
        </button>

        {status && <p className="status-message">{status}</p>}
      </div>
    </section>
  );
}

function shouldUseAiFallback(extracted) {
  return !extracted.key
    || extracted.needsConfirmation
    || extracted.confidence === 'fallback-44-digits'
    || extracted.confidence === 'possible-cfe'
    || extracted.tipo === 'DESCONHECIDO';
}

function compressImageForAi(file) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const url = URL.createObjectURL(file);

    image.onload = () => {
      const maxSize = 1600;
      const scale = Math.min(1, maxSize / Math.max(image.width, image.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(image.width * scale);
      canvas.height = Math.round(image.height * scale);

      const context = canvas.getContext('2d');
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);

      resolve(canvas.toDataURL('image/jpeg', 0.82));
    };

    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Nao foi possivel preparar a imagem para IA.'));
    };

    image.src = url;
  });
}

function SendNotes() {
  const [stats, setStats] = useState({ pendente: 0, processando: 0, enviada: 0, erro: 0 });
  const [notas, setNotas] = useState([]);
  const [logs, setLogs] = useState([]);
  const [status, setStatus] = useState('');
  const eventSourceRef = useRef(null);

  const statItems = useMemo(() => [
    ['Pendentes', stats.pendente],
    ['Processando', stats.processando],
    ['Enviadas', stats.enviada],
    ['Erro', stats.erro]
  ], [stats]);

  async function refresh() {
    const [nextStats, nextNotas] = await Promise.all([api.stats(), api.listNotas()]);
    setStats(nextStats);
    setNotas(nextNotas);
  }

  async function runAction(action, label) {
    setStatus(`${label}...`);
    try {
      await action();
      await refresh();
      setStatus(`${label} concluido.`);
    } catch (error) {
      setStatus(error.message);
    }
  }

  useEffect(() => {
    refresh().catch((error) => setStatus(error.message));
    const interval = window.setInterval(() => refresh().catch(() => {}), 8000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    const source = new EventSource(`${api.baseUrl}/api/automacao/logs`);
    eventSourceRef.current = source;
    source.onmessage = (event) => {
      const entry = JSON.parse(event.data);
      setLogs((current) => [entry, ...current].slice(0, 80));
      refresh().catch(() => {});
    };
    source.onerror = () => setStatus('Conexao de logs interrompida. Tentando reconectar...');
    return () => source.close();
  }, []);

  return (
    <section className="send-layout">
      <div className="stats-grid">
        {statItems.map(([label, value]) => (
          <div className="stat-card" key={label}>
            <span>{label}</span>
            <strong>{value}</strong>
          </div>
        ))}
      </div>

      <div className="toolbar">
        <button className="primary" onClick={() => runAction(api.startAutomation, 'Iniciar automacao')}>
          <CirclePlay aria-hidden="true" />
          Iniciar
        </button>
        <button onClick={() => runAction(api.pauseAutomation, 'Pausar automacao')}>
          <CirclePause aria-hidden="true" />
          Pausar
        </button>
        <button onClick={() => runAction(api.stopAutomation, 'Parar automacao')}>
          <Square aria-hidden="true" />
          Parar
        </button>
        <button onClick={() => runAction(api.sendNext, 'Enviar proxima nota')}>
          <Send aria-hidden="true" />
          Enviar proxima
        </button>
        <button onClick={() => runAction(api.reprocessErrors, 'Reprocessar erros')}>
          <RotateCcw aria-hidden="true" />
          Reprocessar erros
        </button>
      </div>

      {status && <p className="status-message">{status}</p>}

      <div className="dashboard-grid">
        <div className="panel table-panel">
          <h2>Ultimas notas</h2>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Chave</th>
                  <th>Status</th>
                  <th>Data</th>
                  <th>Mensagem</th>
                </tr>
              </thead>
              <tbody>
                {notas.map((nota) => (
                  <tr key={nota.id}>
                    <td>{maskKey(nota.chave_nfe)}</td>
                    <td><span className={`badge ${nota.status}`}>{nota.status}</span></td>
                    <td>{new Date(nota.created_at).toLocaleString('pt-BR')}</td>
                    <td>{nota.mensagem_erro || '-'}</td>
                  </tr>
                ))}
                {!notas.length && (
                  <tr>
                    <td colSpan="4">Nenhuma nota cadastrada.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="panel logs-panel">
          <h2>Logs em tempo real</h2>
          <div className="logs">
            {logs.map((log) => (
              <p key={log.id}>
                <span>[{new Date(log.time).toLocaleTimeString('pt-BR')}]</span> {log.message}
              </p>
            ))}
            {!logs.length && <p>Aguardando eventos da automacao.</p>}
          </div>
        </div>
      </div>
    </section>
  );
}
