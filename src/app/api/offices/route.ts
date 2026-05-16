import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { postQuery } from '@/lib/db-proxy';
import { prisma } from '@/lib/prisma';

export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();

  if (error || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    // Fallback to raw SQL if Prisma client isn't regenerated yet
    let profile: any = null;
    try {
      const result = await prisma.$queryRawUnsafe(
        'SELECT * FROM public.app_users WHERE id = $1 LIMIT 1',
        user.id
      );
      profile = (result as any[])?.[0];
    } catch (e) {

    }

    const isHod = profile?.role === 'hod';
    const assignedOffices = profile?.office_ids || [];


    
    const offices = await postQuery({
      fields: 'ncode, vcompanyname, nunder',
      tableName: 'mstoffice',
      condition: isHod ? '1=1' : `ncode IN (${assignedOffices.map((id: string) => `'${id}'`).join(',') || "''"})`,
      orderBy: 'vcompanyname ASC'
    });


    return NextResponse.json(offices.data);
  } catch (err: any) {

    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
