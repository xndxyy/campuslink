import { NextResponse } from 'next/server';

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return NextResponse.redirect(
    new URL(`/api/campus-work/${encodeURIComponent(id)}`, request.url),
    308,
  );
}
