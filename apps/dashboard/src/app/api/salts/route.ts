import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const matchId = searchParams.get('matchId');
  const round = searchParams.get('round');

  if (!matchId || !round) {
    return NextResponse.json({ error: 'Missing matchId or round' }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin
    .from('salt_vault')
    .select('agent_address, salt_value, move_value')
    .eq('match_id', matchId)
    .eq('round_number', parseInt(round));

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data || []);
}
