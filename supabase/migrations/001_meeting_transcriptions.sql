-- Tabela de transcricoes de reunioes capturadas pela extensao Chrome
CREATE TABLE IF NOT EXISTS public.meeting_transcriptions (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    meeting_date TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    duration_seconds INTEGER,
    participants TEXT[] DEFAULT '{}',
    transcript JSONB NOT NULL DEFAULT '[]',       -- [{timestamp, speaker, text, capturedAt}]
    raw_text TEXT,                                 -- texto corrido para busca full-text
    summary TEXT,                                  -- resumo gerado pela IA
    action_items JSONB DEFAULT '[]',              -- [{title, assignee, type, deadline, reason}]
    decisions JSONB DEFAULT '[]',                 -- [{decision, context}]
    status TEXT NOT NULL DEFAULT 'transcrito',     -- transcrito | resumido | tarefas_extraidas
    source TEXT NOT NULL DEFAULT 'chrome_extension',
    metadata JSONB DEFAULT '{}',                  -- meet_id, meet_url, started_at, ended_at, key_topics
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Indices para consultas frequentes
CREATE INDEX IF NOT EXISTS idx_meeting_transcriptions_client_id
    ON public.meeting_transcriptions(client_id);

CREATE INDEX IF NOT EXISTS idx_meeting_transcriptions_date
    ON public.meeting_transcriptions(meeting_date DESC);

CREATE INDEX IF NOT EXISTS idx_meeting_transcriptions_status
    ON public.meeting_transcriptions(status);

-- Indice full-text no texto corrido para busca
CREATE INDEX IF NOT EXISTS idx_meeting_transcriptions_raw_text
    ON public.meeting_transcriptions USING gin(to_tsvector('portuguese', COALESCE(raw_text, '')));

-- RLS
ALTER TABLE public.meeting_transcriptions ENABLE ROW LEVEL SECURITY;

-- Politica: usuarios autenticados veem transcricoes dos clientes que tem acesso
CREATE POLICY "Authenticated users can view meeting transcriptions"
    ON public.meeting_transcriptions
    FOR SELECT
    TO authenticated
    USING (true);

CREATE POLICY "Service role can manage meeting transcriptions"
    ON public.meeting_transcriptions
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

-- Trigger para updated_at automatico
CREATE OR REPLACE FUNCTION update_meeting_transcription_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER meeting_transcription_updated_at
    BEFORE UPDATE ON public.meeting_transcriptions
    FOR EACH ROW
    EXECUTE FUNCTION update_meeting_transcription_timestamp();
