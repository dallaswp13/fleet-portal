import { NextRequest, NextResponse } from 'next/server'

/**
 * GET /api/image-proxy?url=http://...
 * Proxies driver photos from the NTS S3 bucket (HTTP-only) through our HTTPS server.
 * This avoids mixed-content browser blocking and any S3 CORS restrictions.
 */
export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get('url')
  if (!url) return new NextResponse('Missing url', { status: 400 })

  // Only proxy the known driver photo bucket
  if (!url.includes('driverphoto.nts.taxi') && !url.includes('s3')) {
    return new NextResponse('Forbidden', { status: 403 })
  }

  try {
    const upstream = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 FleetPortal/1.0' },
    })

    if (!upstream.ok) {
      return new NextResponse(null, { status: upstream.status })
    }

    const body        = await upstream.arrayBuffer()
    const contentType = upstream.headers.get('content-type') ?? 'image/jpeg'

    return new NextResponse(body, {
      status:  200,
      headers: {
        'Content-Type':  contentType,
        'Cache-Control': 'public, max-age=86400, stale-while-revalidate=604800',
      },
    })
  } catch {
    return new NextResponse('Upstream error', { status: 502 })
  }
}
