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

    const body = await req.json();
    const { client_id, speaker, command, recent_context, meeting_title } = body;

    if (!client_id || !command) {
      return new Response(
        JSON.stringify({ error: "Campos obrigatorios: client_id, command" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Conectar ao Supabase
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Buscar nome do cliente
    const { data: client } = await supabase
      .from("clients")
      .select("id, name")
      .eq("id", client_id)
      .single();

    const clientName = client?.name || "Cliente";

    // Montar contexto recente como texto
    const contextText = (recent_context || [])
      .map((e: { speaker: string; text: string }) => `[${e.speaker}]: ${e.text}`)
      .join("\n");

    // Chamar OpenAI para entender o comando e gerar resposta
    const openaiKey = Deno.env.get("OPENAI_API_KEY");
    if (!openaiKey) {
      return new Response(
        JSON.stringify({ error: "OPENAI_API_KEY nao configurada" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const systemPrompt = `Voce e a Joyce, assistente de IA da Minatech. Voce esta participando de uma reuniao no Google Meet do cliente "${clientName}".

Voce tem as seguintes capacidades:
1. CRIAR TAREFA: Quando pedirem para criar uma tarefa, extraia titulo, tipo (melhoria/correcao/nova_funcionalidade/administrativa), observacao e prazo
2. RESPONDER PERGUNTAS: Sobre o contexto da reuniao, decisoes tomadas, etc.
3. RESUMIR: Resumir o que foi discutido ate agora
4. ANOTAR: Registrar pontos importantes

IMPORTANTE:
- Responda de forma concisa e natural (como se estivesse falando na reuniao)
- Respostas curtas (1-3 frases no maximo)
- Use portugues brasileiro informal mas profissional
- Quando criar tarefa, confirme o que foi criado
- Se nao entender o comando, peca esclarecimento educadamente

Retorne um JSON com:
{
  "response_text": "texto da sua resposta falada",
  "action": null ou {
    "type": "create_task" | "answer_question" | "summarize" | "take_note",
    "task_data": { // apenas se type = create_task
      "title": "titulo da tarefa",
      "type": "melhoria|correcao|nova_funcionalidade|administrativa",
      "observation": "descricao detalhada",
      "deadline": "YYYY-MM-DD ou null"
    },
    "note_data": { // apenas se type = take_note
      "content": "conteudo da anotacao"
    }
  }
}

Retorne APENAS o JSON valido.`;

    const userMessage = `Reuniao: ${meeting_title || "Sem titulo"}
Cliente: ${clientName}
Quem chamou: ${speaker || "Desconhecido"}
Comando: "${command}"

Contexto recente da reuniao:
${contextText || "(sem contexto anterior)"}`;

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
          { role: "user", content: userMessage },
        ],
        temperature: 0.4,
        max_tokens: 500,
      }),
    });

    if (!openaiResponse.ok) {
      const errText = await openaiResponse.text();
      console.error("Erro OpenAI:", errText);
      return new Response(
        JSON.stringify({
          success: true,
          textResponse: "Desculpa, tive um problema pra processar isso. Pode repetir?",
          action: null,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const aiResult = await openaiResponse.json();
    const content = aiResult.choices?.[0]?.message?.content || "";

    let parsed: {
      response_text?: string;
      action?: {
        type: string;
        task_data?: {
          title: string;
          type: string;
          observation?: string;
          deadline?: string | null;
        };
        note_data?: { content: string };
      } | null;
    };

    try {
      parsed = JSON.parse(content);
    } catch {
      parsed = { response_text: content, action: null };
    }

    const responseText = parsed.response_text || "Entendido!";
    let actionResult: Record<string, unknown> | null = null;

    // Executar acoes
    if (parsed.action?.type === "create_task" && parsed.action.task_data) {
      const td = parsed.action.task_data;

      const { data: task, error: taskError } = await supabase
        .from("tasks")
        .insert({
          client_id,
          title: td.title,
          type: td.type || "administrativa",
          observation: td.observation || null,
          deadline: td.deadline ? `${td.deadline}T12:00:00` : null,
          status: "planejado",
          assigned_to_name: "Joyce",
        })
        .select("id, title")
        .single();

      if (taskError) {
        console.error("Erro ao criar tarefa:", taskError);
        actionResult = { type: "task_created", success: false, error: taskError.message };
      } else {
        console.log(`Tarefa criada pela Joyce: ${task.id} - ${task.title}`);
        actionResult = { type: "task_created", success: true, task_id: task.id, title: task.title };
      }
    }

    if (parsed.action?.type === "take_note" && parsed.action.note_data) {
      const nd = parsed.action.note_data;

      const { error: noteError } = await supabase
        .from("client_meeting_notes")
        .insert({
          client_id,
          title: `Anotacao da reuniao (Joyce) - ${new Date().toLocaleDateString("pt-BR")}`,
          content: nd.content,
          meeting_date: new Date().toISOString(),
        });

      if (noteError) {
        console.error("Erro ao criar anotacao:", noteError);
        actionResult = { type: "note_created", success: false, error: noteError.message };
      } else {
        actionResult = { type: "note_created", success: true };
      }
    }

    // Gerar audio via ElevenLabs (se configurado)
    let audioBase64: string | null = null;
    const elevenLabsKey = Deno.env.get("ELEVENLABS_API_KEY");

    if (elevenLabsKey) {
      try {
        audioBase64 = await generateVoice(elevenLabsKey, responseText);
      } catch (voiceErr) {
        console.error("Erro ao gerar voz:", voiceErr);
        // Continua sem audio — o frontend usara Web Speech API como fallback
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        textResponse: responseText,
        audioUrl: audioBase64 ? `data:audio/mpeg;base64,${audioBase64}` : null,
        action: actionResult,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("Erro interno:", err);
    return new Response(
      JSON.stringify({
        success: false,
        textResponse: "Ops, algo deu errado. Tenta de novo?",
        error: String(err),
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

/**
 * Gera audio via ElevenLabs Text-to-Speech API.
 * Retorna o audio em base64.
 */
async function generateVoice(apiKey: string, text: string): Promise<string> {
  // Voice ID: Rachel (feminina, natural) — pode ser trocada nas configs
  const voiceId = "21m00Tcm4TlvDq8ikWAM"; // Rachel

  const response = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
    {
      method: "POST",
      headers: {
        "xi-api-key": apiKey,
        "Content-Type": "application/json",
        Accept: "audio/mpeg",
      },
      body: JSON.stringify({
        text,
        model_id: "eleven_multilingual_v2", // suporta portugues
        voice_settings: {
          stability: 0.5,
          similarity_boost: 0.75,
          style: 0.3,
          use_speaker_boost: true,
        },
      }),
    }
  );

  if (!response.ok) {
    throw new Error(`ElevenLabs API error: ${response.status} ${await response.text()}`);
  }

  const buffer = await response.arrayBuffer();
  // Converter para base64
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}
