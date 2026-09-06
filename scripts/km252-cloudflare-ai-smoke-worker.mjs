export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/health') return Response.json({ ok: true, ai: Boolean(env.AI) });
    if (request.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });
    if (!env.AI) return Response.json({ ok:false, error:'AI binding unavailable' }, { status:500 });
    const body = await request.json().catch(() => ({}));
    const prompt = String(body.prompt || '');
    if (!prompt) return Response.json({ ok:false, error:'prompt missing' }, { status:400 });
    try {
      const result = await env.AI.run(
        'openai/gpt-4o-mini',
        {
          input: prompt,
          max_output_tokens: 3000,
          tools: [{ type: 'web_search_preview', search_context_size: 'high', filters: { allowed_domains: ['ebay.com'] } }],
        },
        { gateway: { id: 'default' } },
      );
      return Response.json({ ok:true, result });
    } catch (error) {
      return Response.json({ ok:false, error: error instanceof Error ? error.message : String(error) }, { status:500 });
    }
  }
};
