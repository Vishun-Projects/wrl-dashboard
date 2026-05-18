import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { prisma } from '@/lib/prisma';

export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const callId = searchParams.get('callId');

    if (!callId) {
      return NextResponse.json({ error: 'callId is required' }, { status: 400 });
    }

    // Get User Profile for filtering
    const { data: profile } = await supabaseAdmin
      .from('app_users')
      .select('*')
      .eq('id', user.id)
      .single();

    const permissions = await (prisma as any).getUserPermissions(user.id);
    const isHod = 
      permissions.includes('view_all_offices') || 
      permissions.includes('view_reports') ||
      ['super_admin', 'hod', 'Super Admin', 'Office Administrator', 'Account Auditor'].includes(profile?.role || '');
    const assignedOffices = profile?.office_ids || [];

    let query = supabaseAdmin
      .from('call_comments')
      .select('*')
      .eq('call_id', callId);

    // If not HOD, only show comments for their offices
    if (!isHod) {
      query = query.in('office_id', assignedOffices);
    }

    const { data: comments, error } = await query.order('created_at', { ascending: false });

    if (error) throw error;

    const authorIds = Array.from(new Set((comments || []).map((cm: any) => cm.author_id).filter(Boolean)));
    let authors: any[] = [];
    if (authorIds.length > 0) {
      const { data: authorsData } = await supabaseAdmin
        .from('app_users')
        .select('id, avatar_url')
        .in('id', authorIds);
      authors = authorsData || [];
    }

    const commentsWithAvatars = (comments || []).map((cm: any) => {
      const author = authors.find((a: any) => a.id === cm.author_id);
      return {
        ...cm,
        author_avatar_url: author?.avatar_url || null
      };
    });

    return NextResponse.json(commentsWithAvatars);
  } catch (err: any) {

    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await request.json();
    const callId = body.callId || body.call_id;
    const content = body.content || body.text;
    const office_id = body.office_id;
    const author_name = body.author_name;

    if (!callId || !content || !office_id) {
      return NextResponse.json({ error: 'callId, content, and office_id are required' }, { status: 400 });
    }

    // Get User Profile for filtering
    const { data: profile } = await supabaseAdmin
      .from('app_users')
      .select('*')
      .eq('id', user.id)
      .single();

    const permissions = await (prisma as any).getUserPermissions(user.id);
    const isHod = 
      permissions.includes('view_all_offices') || 
      permissions.includes('view_reports') ||
      ['super_admin', 'hod', 'Super Admin', 'Office Administrator', 'Account Auditor'].includes(profile?.role || '');
    const assignedOffices = profile?.office_ids || [];

    // If not HOD, check if they have permission for this office
    if (!isHod && !assignedOffices.includes(String(office_id))) {
      return NextResponse.json({ error: 'Forbidden: You do not have permission to comment for this office' }, { status: 403 });
    }

    const { data: comment, error } = await supabaseAdmin
      .from('call_comments')
      .insert([{
        call_id: String(callId),
        office_id: String(office_id),
        comment: content,
        author_name: author_name || profile?.name || 'User',
        author_id: user.id
      }])
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json(comment);
  } catch (err: any) {

    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
