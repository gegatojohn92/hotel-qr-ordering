import { NextRequest, NextResponse } from 'next/server'
import { RtcTokenBuilder, RtcRole } from 'agora-access-token'

const APP_ID =
  process.env.NEXT_PUBLIC_AGORA_APP_ID ||
  'c2e5d50d9273492d874b2a898f458334'
const APP_CERTIFICATE = process.env.AGORA_APP_CERTIFICATE ?? ''


/**
 * GET /api/agora/token?channel=<channelName>&uid=<uid>
 *
 * Generates a short-lived Agora RTC token for a given channel.
 * uid=1 is reserved for the guest, uid=2 for the answering staff member.
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const channel = searchParams.get('channel')
  const uid = parseInt(searchParams.get('uid') ?? '1', 10)

  if (!channel || !/^[a-zA-Z0-9_\-\.]+$/.test(channel)) {
    return NextResponse.json({ error: 'valid channel name is required' }, { status: 400 })
  }

  if (isNaN(uid) || uid <= 0) {
    return NextResponse.json({ error: 'valid positive integer uid is required' }, { status: 400 })
  }

  if (!APP_ID) {
    return NextResponse.json({ error: 'Agora App ID not configured' }, { status: 500 })
  }

  // If no App Certificate is set, return a null token (Agora Testing Mode)
  let token: string | null = null
  if (APP_CERTIFICATE) {
    const expirySeconds = 86400 // 24 hours
    const currentTimestamp = Math.floor(Date.now() / 1000)
    const privilegeExpiredTs = currentTimestamp + expirySeconds

    token = RtcTokenBuilder.buildTokenWithUid(
      APP_ID,
      APP_CERTIFICATE,
      channel,
      uid,
      RtcRole.PUBLISHER,
      privilegeExpiredTs
    )
  }

  return NextResponse.json({ appId: APP_ID, channel, token, uid })
}
