import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Camera, CirclePause, CirclePlay, LogOut, RotateCcw, RotateCw, Send, Square, Trash2, UploadCloud } from 'lucide-react';
import { createWorker } from 'tesseract.js';
import { api } from './services/api.js';
import { extractFiscalKey, maskKey } from './utils/ocr.js';

const tabs = [
  { id: 'capturar', label: 'Capturar notas' },
  { id: 'enviar', label: 'Enviar notas' }
];

export default function App() {
  const [activeTab, setActiveTab] = useState('capturar');
  const [session, setSession] = useState(() => api.getSession());

  function logout() {
    api.clearSession();
    setSession(null);
  }

  if (!session) {
    return <LoginScreen onLogin={setSession} />;
  }

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
          <button className="logout-button" onClick={logout} title="Sair">
            <LogOut aria-hidden="true" />
            Sair
          </button>
        </nav>
      </header>

      <main>
        {activeTab === 'capturar' ? <CaptureNotes /> : <SendNotes />}
      </main>
    </div>
  );
}

function LoginScreen({ onLogin }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(true);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState('');

  async function submit(event) {
    event.preventDefault();
    setLoading(true);
    setStatus('Entrando...');

    try {
      const nextSession = await api.login({ email, password, remember });
      setStatus('');
      onLogin(nextSession);
    } catch (error) {
      setStatus(error.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="login-page">
      <form className="login-panel" onSubmit={submit}>
        <p className="eyebrow">Acesso restrito</p>
        <h1>Foto Notas</h1>

        <label>
          Email
          <input
            type="email"
            autoComplete="username"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
          />
        </label>

        <label>
          Senha
          <input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
          />
        </label>

        <label className="checkbox-line remember-line">
          <input
            type="checkbox"
            checked={remember}
            onChange={(event) => setRemember(event.target.checked)}
          />
          Lembrar-me
        </label>

        <button className="primary full" disabled={loading}>
          {loading ? 'Entrando...' : 'Entrar'}
        </button>

        {status && <p className="status-message">{status}</p>}
      </form>
    </main>
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
  const [crop, setCrop] = useState({ x: 0.06, y: 0.38, width: 0.88, height: 0.18 });
  const [rotation, setRotation] = useState(0);
  const cropStageRef = useRef(null);
  const imageRef = useRef(null);
  const dragRef = useRef(null);

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
    setCrop({ x: 0.06, y: 0.38, width: 0.88, height: 0.18 });
    setRotation(0);
  }

  function clearImage() {
    if (imageUrl) URL.revokeObjectURL(imageUrl);
    setFile(null);
    setImageUrl('');
    setOcrText('');
    setKey('');
    setTipo('DESCONHECIDO');
    setStatus('');
    setNeedsConfirmation(false);
    setConfirmed(false);
    setCrop({ x: 0.06, y: 0.38, width: 0.88, height: 0.18 });
    setRotation(0);
  }

  function startCropDrag(event) {
    const imageRect = getDisplayedImageRect();
    if (!imageRect) return;
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      initialCrop: crop,
      rect: imageRect
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function moveCrop(event) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;

    const nextX = drag.initialCrop.x + ((event.clientX - drag.startX) / drag.rect.width);
    const nextY = drag.initialCrop.y + ((event.clientY - drag.startY) / drag.rect.height);

    setCrop({
      ...drag.initialCrop,
      x: clamp(nextX, 0, 1 - drag.initialCrop.width),
      y: clamp(nextY, 0, 1 - drag.initialCrop.height)
    });
  }

  function stopCropDrag(event) {
    if (dragRef.current?.pointerId === event.pointerId) {
      dragRef.current = null;
    }
  }

  function getDisplayedImageRect() {
    const stage = cropStageRef.current;
    const image = imageRef.current;
    if (!stage || !image?.naturalWidth || !image?.naturalHeight) return null;

    const stageRect = stage.getBoundingClientRect();
    const rotated = rotation % 180 !== 0;
    const naturalWidth = rotated ? image.naturalHeight : image.naturalWidth;
    const naturalHeight = rotated ? image.naturalWidth : image.naturalHeight;
    const scale = Math.min(stageRect.width / naturalWidth, stageRect.height / naturalHeight);
    const width = naturalWidth * scale;
    const height = naturalHeight * scale;

    return {
      left: (stageRect.width - width) / 2,
      top: (stageRect.height - height) / 2,
      width,
      height
    };
  }

  function cropStyle() {
    const rect = getDisplayedImageRect();
    if (!rect) {
      return {
        left: `${crop.x * 100}%`,
        top: `${crop.y * 100}%`,
        width: `${crop.width * 100}%`,
        height: `${crop.height * 100}%`
      };
    }

    return {
      left: `${rect.left + (rect.width * crop.x)}px`,
      top: `${rect.top + (rect.height * crop.y)}px`,
      width: `${rect.width * crop.width}px`,
      height: `${rect.height * crop.height}px`
    };
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
      await worker.setParameters({
        tessedit_char_whitelist: '0123456789 ',
        tessedit_pageseg_mode: '6',
        preserve_interword_spaces: '1'
      });
      const croppedImage = await prepareImageForRecognition(file, crop, rotation, { output: 'blob', preprocess: true });
      const result = await worker.recognize(croppedImage);
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
    const imageDataUrl = await prepareImageForRecognition(file, crop, rotation, { output: 'dataUrl' });
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
            <div className="crop-stage" ref={cropStageRef}>
              <img
                ref={imageRef}
                src={imageUrl}
                alt="Preview da nota capturada"
                style={{ transform: `rotate(${rotation}deg)` }}
              />
              <div
                className="crop-box"
                style={cropStyle()}
                onPointerDown={startCropDrag}
                onPointerMove={moveCrop}
                onPointerUp={stopCropDrag}
                onPointerCancel={stopCropDrag}
              />
            </div>
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
          <button
            type="button"
            className="icon-only"
            onClick={() => setRotation((current) => (current + 90) % 360)}
            disabled={loading || !file}
            title="Girar leitura"
            aria-label="Girar leitura"
          >
            <RotateCw aria-hidden="true" />
          </button>
          <button
            type="button"
            className="icon-only"
            onClick={clearImage}
            disabled={loading || !file}
            title="Apagar imagem"
            aria-label="Apagar imagem"
          >
            <Trash2 aria-hidden="true" />
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

function prepareImageForRecognition(file, crop, rotation, options = { output: 'blob' }) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const url = URL.createObjectURL(file);

    image.onload = () => {
      const orientedCanvas = drawOrientedImage(image, rotation);
      const safeCrop = clampCrop(crop);
      const sourceX = Math.round(orientedCanvas.width * safeCrop.x);
      const sourceY = Math.round(orientedCanvas.height * safeCrop.y);
      const sourceWidth = Math.round(orientedCanvas.width * safeCrop.width);
      const sourceHeight = Math.round(orientedCanvas.height * safeCrop.height);
      const longSide = Math.max(sourceWidth, sourceHeight);
      const scale = options.preprocess
        ? clamp(2200 / longSide, 1, 3)
        : Math.min(1, 1600 / longSide);
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(sourceWidth * scale));
      canvas.height = Math.max(1, Math.round(sourceHeight * scale));

      const context = canvas.getContext('2d', { willReadFrequently: true });
      context.imageSmoothingEnabled = true;
      context.drawImage(
        orientedCanvas,
        sourceX,
        sourceY,
        sourceWidth,
        sourceHeight,
        0,
        0,
        canvas.width,
        canvas.height
      );
      if (options.preprocess) enhanceReceiptCrop(context, canvas.width, canvas.height);
      URL.revokeObjectURL(url);

      if (options.output === 'dataUrl') {
        resolve(canvas.toDataURL('image/jpeg', 0.86));
        return;
      }

      canvas.toBlob((blob) => {
        if (blob) resolve(blob);
        else reject(new Error('Nao foi possivel preparar o recorte para leitura.'));
      }, 'image/jpeg', 0.9);
    };

    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Nao foi possivel preparar a imagem para leitura.'));
    };

    image.src = url;
  });
}

function enhanceReceiptCrop(context, width, height) {
  const imageData = context.getImageData(0, 0, width, height);
  const { data } = imageData;
  let total = 0;

  for (let index = 0; index < data.length; index += 4) {
    const luminance = (data[index] * 0.299) + (data[index + 1] * 0.587) + (data[index + 2] * 0.114);
    total += luminance;
  }

  const mean = total / (data.length / 4);
  const threshold = clamp(mean - 22, 88, 178);

  for (let index = 0; index < data.length; index += 4) {
    const luminance = (data[index] * 0.299) + (data[index + 1] * 0.587) + (data[index + 2] * 0.114);
    const contrasted = clamp(((luminance - 128) * 1.75) + 128, 0, 255);
    const value = contrasted < threshold ? 0 : 255;

    data[index] = value;
    data[index + 1] = value;
    data[index + 2] = value;
    data[index + 3] = 255;
  }

  context.putImageData(imageData, 0, 0);
}

function drawOrientedImage(image, rotation) {
  const normalizedRotation = ((rotation % 360) + 360) % 360;
  const swapsDimensions = normalizedRotation === 90 || normalizedRotation === 270;
  const canvas = document.createElement('canvas');
  canvas.width = swapsDimensions ? image.height : image.width;
  canvas.height = swapsDimensions ? image.width : image.height;

  const context = canvas.getContext('2d', { willReadFrequently: true });
  context.translate(canvas.width / 2, canvas.height / 2);
  context.rotate((normalizedRotation * Math.PI) / 180);
  context.drawImage(image, -image.width / 2, -image.height / 2);

  return canvas;
}

function clampCrop(crop) {
  return {
    x: clamp(crop.x, 0, 0.95),
    y: clamp(crop.y, 0, 0.95),
    width: clamp(crop.width, 0.05, 1 - crop.x),
    height: clamp(crop.height, 0.05, 1 - crop.y)
  };
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function SendNotes() {
  const [stats, setStats] = useState({ pendente: 0, processando: 0, enviada: 0, erro: 0 });
  const [notas, setNotas] = useState([]);
  const [logs, setLogs] = useState([]);
  const [status, setStatus] = useState('');
  const [deleteStatuses, setDeleteStatuses] = useState(['erro']);
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

  function toggleDeleteStatus(nextStatus) {
    setDeleteStatuses((current) => current.includes(nextStatus)
      ? current.filter((item) => item !== nextStatus)
      : [...current, nextStatus]);
  }

  async function deleteSelectedStatuses() {
    if (!deleteStatuses.length) {
      setStatus('Selecione pelo menos um status para apagar.');
      return;
    }

    const label = deleteStatuses.join(', ');
    const ok = window.confirm(`Apagar notas com status: ${label}? Essa acao nao pode ser desfeita.`);
    if (!ok) return;
    await runAction(() => api.deleteByStatuses(deleteStatuses), 'Apagar selecionadas');
  }

  useEffect(() => {
    refresh().catch((error) => setStatus(error.message));
    const interval = window.setInterval(() => refresh().catch(() => {}), 8000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    const source = new EventSource(api.logsUrl());
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
        <button onClick={deleteSelectedStatuses}>
          <Trash2 aria-hidden="true" />
          Apagar selecionadas
        </button>
      </div>

      <div className="delete-options">
        {['pendente', 'processando', 'erro', 'enviada'].map((item) => (
          <label className="status-check" key={item}>
            <input
              type="checkbox"
              checked={deleteStatuses.includes(item)}
              onChange={() => toggleDeleteStatus(item)}
            />
            {item}
          </label>
        ))}
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
