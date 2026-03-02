import { NextResponse } from 'next/server';

export async function GET() {
  try {
    const upiId = (process.env.UPI_ID || '').trim();
    if (!upiId) {
      return NextResponse.json(
        { message: 'UPI_ID is not configured on the server.' },
        { status: 500 }
      );
    }

    return NextResponse.json({ upiId }, { status: 200 });
  } catch (_error) {
    return NextResponse.json(
      { message: 'Failed to load payment configuration.' },
      { status: 500 }
    );
  }
}
