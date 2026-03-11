import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-meet-api-key, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // Autenticacao
    const apiKey = req.headers.get("x-meet-api-key");
    const validKey = Deno.env.get("MEET_API_KEY");
    if (!apiKey || apiKey !== validKey) {
      return new Response(JSON.stringify({ error: "API key invalida" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { transcription_id } = await req.json();
    if (!transcription_id) {
      return new Response(
        JSON.stringify({ error: "transcription_id obrigatorio" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Buscar transcricao
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { data: transcription, error: fetchError } = await supabase
      .from("meeting_transcriptions")
      .select("*")
      .eq("id", transcription_id)
      .single();

    if (fetchError || !transcription) {
      return new Response(
        JSON.stringify({ error: "Transcricao nao encontrada" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Montar texto para a OpenAI
    const rawText = transcription.raw_text ||
      (transcription.transcript as Array<{ speaker: string; text: string }>)
        .map((e) => `[${e.speaker}]: ${e.text}`)
        .join("\n");

    // Chamar OpenAI
    const openaiKey = Deno.env.get("OPENAI_API_KEY");
    if (!openaiKey) {
      return new Response(
        JSON.stringify({ error: "OPENAI_API_KEY nao configurada" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const systemPrompt = `Voce e um assistente de reunioes empresariais. Analise a transcricao abaixo e retorne um JSON com:
{
  "summary": "Resumo executivo da reuniao em 3-5 paragrafos",
  "action_items": [
    {
      "title": "descricao da tarefa",
      "assignee": "nome do responsavel (se mencionado)",
      "type": "melhoria|correcao|nova_funcionalidade|administrativa",
      "deadline": "data mencionada ou null",
      "reason": "por que essa tarefa foi identificada"
    }
  ],
  "decisions": [
    {
      "decision": "decisao tomada",
      "context": "contexto em que foi discutida"
    }
  ],
  "key_topics": ["topico1", "topico2"]
}

Retorne APENAS o JSON valido, sem markdown ou texto extra.
Responda em portugues brasileiro.`;

    const openaiResponse = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${openaiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: systemPrompt },
          {
            role: "user",
            content: `Titulo da reuniao: ${transcription.title}\nParticipantes: ${(transcription.participants || []).join(", ")}\nDuracao: ${transcription.duration_seconds ? Math.round(transcription.duration_seconds / 60) + " minutos" : "desconhecida"}\n\nTranscricao:\n${rawText}`,
          },
        ],
        temperature: 0.3,
        max_tokens: 2000,
      }),
    });

    if (!openaiResponse.ok) {
      const errText = await openaiResponse.text();
      console.error("Erro OpenAI:", errText);
      return new Response(
        JSON.stringify({ error: "Erro ao chamar OpenAI", details: errText }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const aiResult = await openaiResponse.json();
    const content = aiResult.choices?.[0]?.message?.content || "";

    let parsed: {
      summary?: string;
      action_items?: unknown[];
      decisions?: unknown[];
      key_topics?: string[];
    };

    try {
      parsed = JSON.parse(content);
    } catch {
      // Se a IA retornou texto em vez de JSON, tratar como resumo
      parsed = { summary: content, action_items: [], decisions: [] };
    }

    // Atualizar transcricao no banco
    const { error: updateError } = await supabase
      .from("meeting_transcriptions")
      .update({
        summary: parsed.summary || null,
        action_items: parsed.action_items || [],
        decisions: parsed.decisions || [],
        status: "resumido",
        metadata: {
          ...((transcription.metadata as Record<string, unknown>) || {}),
          key_topics: parsed.key_topics || [],
          summarized_at: new Date().toISOString(),
        },
        updated_at: new Date().toISOString(),
      })
      .eq("id", transcription_id);

    if (updateError) {
      console.error("Erro ao atualizar transcricao:", updateError);
      return new Response(
        JSON.stringify({ error: "Erro ao salvar resumo", details: updateError.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`Transcricao ${transcription_id} sumarizada com sucesso`);

    return new Response(
      JSON.stringify({
        success: true,
        summary: parsed.summary,
        action_items: parsed.action_items,
        decisions: parsed.decisions,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("Erro interno:", err);
    return new Response(
      JSON.stringify({ error: "Erro interno", details: String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
