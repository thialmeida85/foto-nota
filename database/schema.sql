CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS notas_fiscais (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chave_nfe TEXT NOT NULL,
  tipo TEXT NULL,
  status TEXT NOT NULL DEFAULT 'pendente',
  origem TEXT DEFAULT 'celular',
  ocr_texto TEXT NULL,
  mensagem_erro TEXT NULL,
  tentativas INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  sent_at TIMESTAMP NULL,
  CONSTRAINT notas_fiscais_status_check CHECK (status IN ('pendente', 'processando', 'enviada', 'erro')),
  CONSTRAINT notas_fiscais_chave_unique UNIQUE (chave_nfe)
);

CREATE INDEX IF NOT EXISTS idx_notas_fiscais_status ON notas_fiscais(status);
CREATE INDEX IF NOT EXISTS idx_notas_fiscais_created_at ON notas_fiscais(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notas_fiscais_chave_nfe ON notas_fiscais(chave_nfe);

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_notas_fiscais_updated_at ON notas_fiscais;

CREATE TRIGGER trg_notas_fiscais_updated_at
BEFORE UPDATE ON notas_fiscais
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

