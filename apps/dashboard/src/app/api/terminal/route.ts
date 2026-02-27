import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { chatWithFalken, ModelTier } from '@/lib/llm';

// Server-side environment variables
const supabase = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

export async function POST(req: Request) {
  try {
    const { query, managerAddress, tier = 'GPT-4O-MINI' } = await req.json();

    if (!query) {
      return NextResponse.json({ error: 'Missing query' }, { status: 400 });
    }

    // 1. Get Manager ID
    let managerId: string | null = null;
    if (managerAddress) {
      const { data: manager } = await supabase
        .from('manager_profiles')
        .select('id')
        .eq('address', managerAddress.toLowerCase())
        .maybeSingle();
      managerId = manager?.id || null;
    }

    // 2. Chat with Falken Brain
    const aiResponse = await chatWithFalken(query, tier as ModelTier);

    // 3. Log Query (Intel Lens Data)
    await supabase.from('terminal_queries').insert({
      manager_id: managerId,
      query_text: query,
      ai_response: aiResponse
    });

    return NextResponse.json({ response: aiResponse });

  } catch (err: any) {
    console.error('API_TERMINAL_ERROR:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
