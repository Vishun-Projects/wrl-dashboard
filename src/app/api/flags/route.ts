import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();

  if (error || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { call_id, office_id, flag_type, vtrnno } = await request.json();


    const { error: upsertError } = await supabaseAdmin
      .from('call_flags')
      .upsert({
        call_id: String(call_id),
        office_id: String(office_id),
        vtrnno: vtrnno || null,
        flag_type,
        set_by: user.id,
        set_at: new Date().toISOString(),
        is_active: true
      }, { onConflict: 'call_id' });

    if (upsertError) {

      throw upsertError;
    }

    const { error: logError } = await supabaseAdmin.from('flag_audit_log').insert({
      call_id: String(call_id),
      office_id: String(office_id),
      new_flag: flag_type,
      changed_by: user.id
    });



    return NextResponse.json({ success: true });
  } catch (err: any) {

    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
