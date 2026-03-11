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
    // Autenticacao via API key
    const apiKey = req.headers.get("x-meet-api-key");
    const validKey = Deno.env.get("MEET_API_KEY");

    if (!apiKey || apiKey !== validKey) {
      return new Response(JSON.stringify({ error: "API key invalida" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json();

    // Ping para teste de conexao
    if (body.action === "ping") {
      return new Response(JSON.stringify({ success: true, message: "pong" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Validar campos obrigatorios
    const { client_id, title, transcript, raw_text } = body;
    if (!client_id || !title || !transcript) {
      return new Response(
        JSON.stringify({ error: "Campos obrigatorios: client_id, title, transcript" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Conectar ao Supabase
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Verificar se o cliente existe
    const { data: client, error: clientError } = await supabase
      .from("clients")
      .select("id, name")
      .eq("id", client_id)
      .single();

    if (clientError || !client) {
      return new Response(
        JSON.stringify({ error: "Cliente nao encontrado", details: clientError?.message }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Inserir transcricao
    const { data: transcription, error: insertError } = await supabase
      .from("meeting_transcriptions")
      .insert({
        client_id,
        title,
        meeting_date: body.started_at || new Date().toISOString(),
        duration_seconds: body.duration_seconds || null,
        participants: body.participants || [],
        transcript, // JSONB array de {timestamp, speaker, text, capturedAt}
        raw_text: raw_text || "",
        status: "transcrito",
        source: "chrome_extension",
        metadata: {
          meet_id: body.meet_id || null,
          meet_url: body.meet_url || null,
          started_at: body.started_at || null,
          ended_at: body.ended_at || null,
        },
      })
      .select("id")
      .single();

    if (insertError) {
      console.error("Erro ao inserir transcricao:", insertError);
      return new Response(
        JSON.stringify({ error: "Erro ao salvar transcricao", details: insertError.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(
      `Transcricao salva: ${transcription.id} | Cliente: ${client.name} | ${transcript.length} falas`
    );

    return new Response(
      JSON.stringify({
        success: true,
        transcription_id: transcription.id,
        message: `Transcricao "${title}" salva com sucesso`,
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
